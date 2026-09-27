import assert from "node:assert/strict";
import { test } from "node:test";
import { createCloudTarget, CloudTargetError } from "./targets.server.ts";

/**
 * 适配器测试：替换 globalThis.fetch 记录请求、回放状态码——
 * 不真连任何服务器。S3 走真实 aws4fetch 签名（Node crypto.subtle 在场），
 * 只断言 URL 形状与方法，不断言签名值。
 */

type Call = { method: string; url: string; status: number };
let calls: Call[] = [];
let responder: (req: { method: string; url: URL }) => { status: number; body?: string } = () => ({ status: 200 });

function installFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // aws4fetch 会传 Request 对象进来；统一归一成 method+url 再回放
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const out = responder({ method, url });
    calls.push({ method, url: url.toString(), status: out.status });
    // 204/304 不允许带体，Response 构造器会直接抛
    const body = out.body ?? (out.status === 204 || out.status === 304 ? null : "");
    return new Response(body, { status: out.status });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const WEBDAV = {
  kind: "webdav" as const,
  url: "https://dav.example.com/dav/",
  username: "u",
  password: "p",
  remoteDir: "kami",
};

test("webdav probe：递归 MKCOL + PROPFIND 207；已存在（405）不报错", async () => {
  const restore = installFetch();
  try {
    calls = [];
    responder = ({ method, url }) => {
      if (method === "MKCOL") return { status: url.pathname.endsWith("/kami") ? 201 : 405 };
      if (method === "PROPFIND") return { status: 207, body: "<multistatus/>" };
      return { status: 500 };
    };
    await createCloudTarget(WEBDAV).probe();
    assert.equal(calls.filter((c) => c.method === "MKCOL").length, 1);
    assert.equal(calls.some((c) => c.method === "PROPFIND" && c.url === "https://dav.example.com/dav/kami"), true);
    // Authorization 头在场由 fetch 桩外的 request() 统一加——桩里拿不到头，改验 URL 与方法即可
  } finally {
    restore();
  }
});

test("webdav 基础认证头在场、路径编码", async () => {
  const restore = installFetch();
  try {
    let seenAuth = "";
    let seenPath = "";
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      seenAuth = String(new Headers(init?.headers).get("authorization") ?? "");
      seenPath = url.pathname;
      return new Response("", { status: 201 });
    }) as typeof fetch;
    try {
      await createCloudTarget(WEBDAV).putFile("files/pixiv 画/0.jpg", new Uint8Array([1]));
      assert.equal(seenAuth, `Basic ${Buffer.from("u:p").toString("base64")}`);
      assert.equal(seenPath, "/dav/kami/files/pixiv%20%E7%94%BB/0.jpg");
    } finally {
      globalThis.fetch = original;
    }
  } finally {
    restore();
  }
});

test("webdav listDir 解析 href、滤自身；getFile 404 抛 CloudTargetError", async () => {
  const restore = installFetch();
  try {
    responder = ({ method }) => {
      if (method === "PROPFIND") {
        // 真实服务器形态：第一段是被列目录自身，其余是子项
        return {
          status: 207,
          body:
            "<D:multistatus>" +
            "<D:response><D:href>/dav/kami/catalog/</D:href></D:response>" +
            "<D:response><D:href>/dav/kami/catalog/vault-meta-20260921-100000.sqlite</D:href></D:response>" +
            "<D:response><D:href>/dav/kami/catalog/vault-meta-20260920-100000.sqlite</D:href></D:response>" +
            "</D:multistatus>",
        };
      }
      if (method === "GET") return { status: 404 };
      return { status: 200 };
    };
    const target = createCloudTarget(WEBDAV);
    const names = await target.listDir("catalog");
    assert.deepEqual(names, ["vault-meta-20260921-100000.sqlite", "vault-meta-20260920-100000.sqlite"]);
    await assert.rejects(() => target.getFile("manifest.json"), CloudTargetError);
  } finally {
    restore();
  }
});

test("webdav deleteFile：404 视为已删", async () => {
  const restore = installFetch();
  try {
    responder = () => ({ status: 404 });
    await createCloudTarget(WEBDAV).deleteFile("catalog/x.sqlite");
    responder = () => ({ status: 204 });
    await createCloudTarget(WEBDAV).deleteFile("catalog/x.sqlite");
  } finally {
    restore();
  }
});

const S3 = {
  kind: "s3" as const,
  endpoint: "https://acc.r2.cloudflarestorage.com",
  region: "auto",
  bucket: "kami",
  accessKeyId: "AK",
  secretAccessKey: "SK",
  remoteDir: "kami",
};

test("s3 probe/listDir：list-type=2 与 Contents 解析", async () => {
  const restore = installFetch();
  try {
    responder = ({ url }) => {
      if (url.searchParams.get("list-type") === "2") {
        if (Number(url.searchParams.get("max-keys")) === 1) return { status: 200 };
        return {
          status: 200,
          body:
            "<ListBucketResult>" +
            "<Contents><Key>kami/catalog/vault-meta-a.sqlite</Key><Size>10</Size></Contents>" +
            "<Contents><Key>kami/catalog/vault-meta-b.sqlite</Key><Size>20</Size></Contents>" +
            "</ListBucketResult>",
        };
      }
      return { status: 200 };
    };
    const target = createCloudTarget(S3);
    await target.probe();
    const names = await target.listDir("catalog");
    assert.deepEqual(names, ["vault-meta-a.sqlite", "vault-meta-b.sqlite"]);
    assert.ok(calls.some((c) => c.url.includes("/kami") && c.url.includes("list-type=2") && c.url.includes("max-keys=1")));
    assert.ok(calls.some((c) => c.url.includes("prefix=kami%2Fcatalog%2F")));
  } finally {
    restore();
  }
});

test("s3 probe 403 给可读错误；putFile 走 PUT 对象 URL", async () => {
  const restore = installFetch();
  try {
    responder = ({ method }) => (method === "GET" ? { status: 403 } : { status: 200 });
    await assert.rejects(() => createCloudTarget(S3).probe(), /密钥被拒/);
    responder = () => ({ status: 200 });
    await createCloudTarget(S3).putFile("files/a/0.jpg", new Uint8Array([1, 2]));
    assert.equal(calls.at(-1)!.method, "PUT");
    assert.equal(calls.at(-1)!.url, "https://acc.r2.cloudflarestorage.com/kami/kami/files/a/0.jpg");
  } finally {
    restore();
  }
});
