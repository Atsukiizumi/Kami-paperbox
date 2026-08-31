import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getActiveProxy } from "./proxy.server";

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

export async function outboundFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!getActiveProxy()) {
    return fetch(url, init);
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
