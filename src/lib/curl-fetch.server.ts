/**
 * 出站 HTTP。
 *
 * 作用：无代理走 Node fetch；有代理走 undici ProxyAgent 持久连接池，过不去降级 curl。
 * 用法：outboundFetch(url, init)，与 fetch 相近；代理来自 getActiveProxy()。
 * 为什么：curl 每请求一个新进程 + 新 TLS 握手，配代理实测 Pixiv 单请求 1~6 秒
 *        且越连越慢；连接池复用后回到几百毫秒。个别网络 undici 隧道建不起来，
 *        保留 curl 兜底（连续失败熔断 10 分钟，避免每次都付双份超时）。
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { getActiveProxy } from "./proxy.server.ts";

export type CurlFormField = {
  name: string;
  value?: string;
  file?: string;
  filename?: string;
  type?: string;
};

export type CurlInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer | string;
  form?: CurlFormField[];
  timeout?: number;
  proxy?: string | null;
};

export type CurlResult = {
  status: number;
  contentType: string;
  body: Buffer;
  headerText: string;
};

export async function curlRequest(url: string, init: CurlInit = {}): Promise<CurlResult> {
  const dir = mkdtempSync(join(tmpdir(), "kami-curl-"));
  const bodyPath = join(dir, "body");
  const headerPath = join(dir, "headers");
  const method = (init.method ?? (init.body || init.form ? "POST" : "GET")).toUpperCase();
  const args = [
    "-sS",
    "-L",
    "--max-time",
    String(init.timeout ?? 40),
    "-D",
    headerPath,
    "-o",
    bodyPath,
    "-w",
    "%{http_code}\t%{content_type}",
    "-X",
    method,
  ];
  const proxy = init.proxy === undefined ? getActiveProxy() : init.proxy;
  if (proxy) args.push("-x", proxy);

  const headers = init.headers ?? {};
  const ua = headers["User-Agent"] ?? headers["user-agent"];
  if (ua) args.push("-A", ua);
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "user-agent") continue;
    args.push("-H", `${key}: ${value}`);
  }

  let stdin: Buffer | undefined;
  if (init.form?.length) {
    for (const field of init.form) {
      if (field.file) {
        const filename = field.filename || "upload.bin";
        const type = field.type || "application/octet-stream";
        args.push("-F", `${field.name}=@${field.file};filename=${filename};type=${type}`);
      } else {
        args.push("-F", `${field.name}=${field.value ?? ""}`);
      }
    }
  } else if (init.body !== undefined) {
    stdin = typeof init.body === "string" ? Buffer.from(init.body) : init.body;
    args.push("--data-binary", "@-");
  }

  args.push(url);

  try {
    const meta = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn("curl", args, { windowsHide: true });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on("data", (chunk) => out.push(chunk as Buffer));
      child.stderr.on("data", (chunk) => err.push(chunk as Buffer));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve(Buffer.concat(out));
          return;
        }
        reject(new Error(Buffer.concat(err).toString("utf8").trim() || `curl 退出 ${code ?? "?"}`));
      });
      if (stdin && stdin.byteLength) child.stdin.end(stdin);
      else child.stdin.end();
    });
    const text = meta.toString("utf8").trim();
    const tab = text.indexOf("\t");
    const status = Number(tab >= 0 ? text.slice(0, tab) : text) || 0;
    const contentType = (tab >= 0 ? text.slice(tab + 1) : "") || "application/octet-stream";
    let body = Buffer.alloc(0);
    let headerText = "";
    try {
      body = readFileSync(bodyPath);
    } catch {
      console.warn("[curl-fetch:read] curl 结果 body 文件缺失（按空响应处理）：", bodyPath);
      body = Buffer.alloc(0);
    }
    try {
      headerText = readFileSync(headerPath, "utf8");
    } catch {
      headerText = "";
    }
    return { status, contentType, body, headerText };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function curlFetch(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; contentType: string; body: Buffer }> {
  const res = await curlRequest(url, { headers });
  return { status: res.status, contentType: res.contentType, body: res.body };
}

function headersOf(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init?.headers) return out;
  const headers = new Headers(init.headers);
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function formOf(form: FormData): Promise<{ fields: CurlFormField[]; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "kami-form-"));
  const fields: CurlFormField[] = [];
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") {
      fields.push({ name, value });
      continue;
    }
    const file = value as File;
    const path = join(dir, randomBytes(8).toString("hex"));
    writeFileSync(path, Buffer.from(await file.arrayBuffer()));
    fields.push({
      name,
      file: path,
      filename: file.name || "upload.bin",
      type: file.type || "application/octet-stream",
    });
  }
  return {
    fields,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function responseFromCurl(res: CurlResult): Response {
  const headers = new Headers();
  if (res.contentType) headers.set("content-type", res.contentType);
  for (const line of res.headerText.split(/\r?\n/)) {
    const match = /^set-cookie:\s*(.+)$/i.exec(line);
    if (match?.[1]) headers.append("set-cookie", match[1].trim());
  }
  return new Response(new Uint8Array(res.body), { status: res.status || 502, headers });
}

// ── 代理出站的持久连接池 ─────────────────────────────────────────────────────
// 为什么：过去配了代理就走「每请求一个 curl 子进程」——新进程 + 新 TCP + 全新 TLS
// 握手，实测 Pixiv 单请求 1~6 秒且连续请求越来越慢（出口对频繁新建连接不友好）。
// undici 的 ProxyAgent 复用连接，预热后单请求回到几百毫秒。个别网络 undici 隧道
// 过不去（当年模板为此用 curl），所以留 curl 兜底：连续 3 次传输失败就熔断 10 分钟。
const PROXY_POOL_KEEPALIVE = 10 * 60_000;
const PROXY_POOL_FAIL_LIMIT = 3;
const proxyPool = globalThis as typeof globalThis & {
  __kamiProxyAgent?: ProxyAgent;
  __kamiProxyFails__?: number;
  __kamiProxyCooldownUntil__?: number;
};

function getProxyDispatcher(proxy: string) {
  proxyPool.__kamiProxyAgent ??= new ProxyAgent({
    uri: proxy,
    connect: { timeout: 15_000 },
    // 与 curl --max-time 40 对齐
    headersTimeout: 45_000,
    bodyTimeout: 45_000,
    connections: 16,
  });
  return proxyPool.__kamiProxyAgent;
}

function proxyPoolAvailable(): boolean {
  return Date.now() >= (proxyPool.__kamiProxyCooldownUntil__ ?? 0);
}

function noteProxyPoolResult(ok: boolean) {
  if (ok) {
    proxyPool.__kamiProxyFails__ = 0;
    return;
  }
  proxyPool.__kamiProxyFails__ = (proxyPool.__kamiProxyFails__ ?? 0) + 1;
  if (proxyPool.__kamiProxyFails__ >= PROXY_POOL_FAIL_LIMIT) {
    proxyPool.__kamiProxyCooldownUntil__ = Date.now() + PROXY_POOL_KEEPALIVE;
    proxyPool.__kamiProxyFails__ = 0;
    console.warn("[outbound] 连接池连续失败，接下来 10 分钟走 curl");
  }
}

async function proxyPoolFetch(url: string, init: RequestInit, proxy: string): Promise<Response> {
  const res = await undiciFetch(url, {
    ...init,
    dispatcher: getProxyDispatcher(proxy),
  } as Parameters<typeof undiciFetch>[1]);
  return res as unknown as Response;
}

export async function outboundFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (init.signal?.aborted) {
    throw new DOMException("This operation was aborted", "AbortError");
  }
  const proxy = getActiveProxy();
  if (!proxy) {
    return fetch(url, init);
  }
  if (proxyPoolAvailable()) {
    try {
      const res = await proxyPoolFetch(url, init, proxy);
      noteProxyPoolResult(true);
      return res;
    } catch (err) {
      if (init.signal?.aborted) throw err;
      noteProxyPoolResult(false);
      if (typeof console !== "undefined") {
        console.warn(
          "[outbound] 连接池请求失败，本次降级 curl：",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
  const headers = headersOf(init);
  const body = init.body;
  let cleanup: (() => void) | undefined;
  try {
    if (body instanceof FormData) {
      const form = await formOf(body);
      cleanup = form.cleanup;
      return responseFromCurl(await curlRequest(url, { method: init.method, headers, form: form.fields }));
    }
    let payload: Buffer | string | undefined;
    if (typeof body === "string") payload = body;
    else if (body instanceof URLSearchParams) {
      headers["Content-Type"] ??= "application/x-www-form-urlencoded; charset=utf-8";
      payload = body.toString();
    } else if (body instanceof Uint8Array) payload = Buffer.from(body);
    else if (typeof Buffer !== "undefined" && body && Buffer.isBuffer(body)) payload = body;
    else if (body) payload = Buffer.from(await new Response(body).arrayBuffer());
    return responseFromCurl(await curlRequest(url, { method: init.method, headers, body: payload }));
  } finally {
    cleanup?.();
  }
}

export async function probeProxy(
  url = "https://www.pixiv.net/",
  proxy = getActiveProxy(),
): Promise<{ ok: boolean; status: number; message: string }> {
  if (!proxy) return { ok: false, status: 0, message: "还没有填写代理地址" };
  try {
    const res = await curlRequest(url, {
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
      timeout: 15,
      proxy,
    });
    if (res.status >= 200 && res.status < 500) {
      return { ok: true, status: res.status, message: `连通（HTTP ${res.status}）` };
    }
    return { ok: false, status: res.status, message: `代理返回 ${res.status}` };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : "探测失败" };
  }
}
