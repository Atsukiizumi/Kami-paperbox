/**
 * 云目标适配器：WebDAV 与 S3 兼容（aws4fetch 签名）。
 *
 * 作用：备份引擎只面对 probe/putFile/getFile/listDir/deleteFile 五个动作；
 *      协议差异（MKCOL 建目录、PROPFIND 解析、sigv4 签名）收在这一个文件。
 * 用法：const target = createCloudTarget(config)；只在服务端 import（凭据在场）。
 * 为什么：双协议是拍板范围；自写 sigv4 是重复造轮子，aws4fetch 纯 fetch 签名零原生编译。
 *      列目录用正则抽 href/Key——两类服务器的 XML 形状都稳定，不为此引 XML 依赖。
 */
import { AwsClient } from "aws4fetch";
import { getLogger } from "../../log.server.ts";
import type { CloudTargetConfig } from "./types.ts";

const log = getLogger("cloud-backup:target");

export class CloudTargetError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

export type CloudTargetClient = {
  probe: () => Promise<void>;
  putFile: (rel: string, bytes: Uint8Array) => Promise<void>;
  getFile: (rel: string) => Promise<Uint8Array>;
  /** 某目录下的条目名（不含路径前缀，不含自身）。 */
  listDir: (rel: string) => Promise<string[]>;
  deleteFile: (rel: string) => Promise<void>;
};

const OK = new Set([200, 201, 204, 207]);
const EXISTS = new Set([200, 201, 301, 405, 409]);

function assertStatus(res: Response, what: string, allowed: Iterable<number>) {
  if (![...allowed].includes(res.status)) {
    throw new CloudTargetError(`${what} 失败（HTTP ${res.status}）`, res.status);
  }
}

function relSegments(cfg: CloudTargetConfig, rel: string): string[] {
  const clean = rel.split("/").map((s) => s.trim()).filter(Boolean);
  return [...cfg.remoteDir.split("/").filter(Boolean), ...clean];
}

function webdavPath(cfg: Extract<CloudTargetConfig, { kind: "webdav" }>, rel: string): string {
  return relSegments(cfg, rel).map(encodeURIComponent).join("/");
}

function s3Key(cfg: Extract<CloudTargetConfig, { kind: "s3" }>, rel: string): string {
  return relSegments(cfg, rel).join("/");
}

function createWebDav(cfg: Extract<CloudTargetConfig, { kind: "webdav" }>): CloudTargetClient {
  const base = cfg.url.replace(/\/+$/, "");
  const auth = `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64")}`;

  async function request(method: string, rel: string, init?: RequestInit): Promise<Response> {
    return fetch(`${base}/${webdavPath(cfg, rel)}`, {
      method,
      ...init,
      headers: { ...(init?.headers ?? {}), authorization: auth },
      // 重定向不跟随：跟进会带丢 Authorization / 方法改写，失败直接暴露状态码
      redirect: "manual",
      signal: AbortSignal.timeout(45_000),
    });
  }

  async function ensureDir(): Promise<void> {
    const segs = cfg.remoteDir.split("/").filter(Boolean);
    // MKCOL 逐段建：路径直接挂在站点根下（不在 remoteDir 前缀里再叠一层）
    for (let i = 1; i <= segs.length; i += 1) {
      const seg = segs[i - 1]!;
      try {
        const res = await fetch(`${base}/${segs.slice(0, i).map(encodeURIComponent).join("/")}`, {
          method: "MKCOL",
          headers: { authorization: auth },
          redirect: "manual",
          signal: AbortSignal.timeout(45_000),
        });
        assertStatus(res, `建目录 ${seg}`, EXISTS);
      } catch (err) {
        if (err instanceof CloudTargetError && EXISTS.has(err.status)) continue;
        throw err;
      }
    }
  }

  return {
    async probe() {
      await ensureDir();
      const res = await request("PROPFIND", "", { headers: { depth: "0" } });
      assertStatus(res, "连接测试", new Set([200, 207]));
    },
    async putFile(rel, bytes) {
      const res = await request("PUT", rel, { body: bytes as unknown as BodyInit });
      assertStatus(res, `上传 ${rel}`, OK);
    },
    async getFile(rel) {
      const res = await request("GET", rel);
      assertStatus(res, `下载 ${rel}`, OK);
      return new Uint8Array(await res.arrayBuffer());
    },
    async listDir(rel) {
      const res = await request("PROPFIND", rel ? `${rel}/` : "", { headers: { depth: "1" } });
      assertStatus(res, `列目录 ${rel}`, new Set([200, 207]));
      const text = await res.text();
      const selfSeg = rel.split("/").filter(Boolean).at(-1);
      const names: string[] = [];
      for (const m of text.matchAll(/<(?:[a-zA-Z0-9]+:)?href>([^<]*)<\/(?:[a-zA-Z0-9]+:)?href>/g)) {
        let name: string;
        try {
          name = decodeURIComponent(m[1]!.split("?")[0]!);
        } catch {
          continue;
        }
        const trimmed = name.replace(/\/+$/, "");
        const base = trimmed.split("/").filter(Boolean).at(-1) ?? "";
        if (!base || base === selfSeg) continue;
        if (!names.includes(base)) names.push(base);
      }
      return names;
    },
    async deleteFile(rel) {
      const res = await request("DELETE", rel);
      if (res.status === 404) return;
      assertStatus(res, `删除 ${rel}`, OK);
    },
  };
}

function createS3(cfg: Extract<CloudTargetConfig, { kind: "s3" }>): CloudTargetClient {
  const base = cfg.endpoint.replace(/\/+$/, "");
  const client = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, service: "s3", region: cfg.region || "auto" });
  const objectUrl = (rel: string) => `${base}/${encodeURIComponent(cfg.bucket)}/${s3Key(cfg, rel).split("/").map(encodeURIComponent).join("/")}`;

  async function request(method: string, url: string, init?: RequestInit): Promise<Response> {
    return client.fetch(url, { method, ...init, signal: AbortSignal.timeout(45_000) });
  }

  return {
    async probe() {
      const res = await request("GET", `${base}/${encodeURIComponent(cfg.bucket)}?list-type=2&max-keys=1`);
      if (res.status === 200) return;
      throw new CloudTargetError(res.status === 403 ? "连接测试失败：密钥被拒（403）" : `连接测试失败（HTTP ${res.status}）`, res.status);
    },
    async putFile(rel, bytes) {
      const res = await request("PUT", objectUrl(rel), { body: bytes as unknown as BodyInit });
      assertStatus(res, `上传 ${rel}`, OK);
    },
    async getFile(rel) {
      const res = await request("GET", objectUrl(rel));
      assertStatus(res, `下载 ${rel}`, OK);
      return new Uint8Array(await res.arrayBuffer());
    },
    async listDir(rel) {
      const prefix = [cfg.remoteDir, rel].filter(Boolean).join("/");
      const url = `${base}/${encodeURIComponent(cfg.bucket)}?list-type=2&max-keys=1000&prefix=${encodeURIComponent(prefix ? `${prefix}/` : "")}`;
      const res = await request("GET", url);
      assertStatus(res, `列目录 ${rel}`, OK);
      const text = await res.text();
      const names: string[] = [];
      for (const m of text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = m[1]?.match(/<Key>([^<]*)<\/Key>/)?.[1];
        if (!key) continue;
        let name: string;
        try {
          name = decodeURIComponent(key);
        } catch {
          continue;
        }
        const baseName = name.slice(name.lastIndexOf("/") + 1);
        if (baseName && !names.includes(baseName)) names.push(baseName);
      }
      return names;
    },
    async deleteFile(rel) {
      const res = await request("DELETE", objectUrl(rel));
      if (res.status === 404) return;
      assertStatus(res, `删除 ${rel}`, OK);
    },
  };
}

export function createCloudTarget(cfg: CloudTargetConfig): CloudTargetClient {
  const target = cfg.kind === "webdav" ? createWebDav(cfg) : createS3(cfg);
  // 包一层：协议错误统一带上下文进日志，调用方拿到的仍是原错误
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const out = (value as (...a: unknown[]) => unknown).apply(t, args);
        if (out instanceof Promise) {
          return out.catch((err) => {
            log.warn(`云目标操作失败（${cfg.kind} ${cfg.remoteDir}）：`, err instanceof Error ? err.message : err);
            throw err;
          });
        }
        return out;
      };
    },
  });
}
