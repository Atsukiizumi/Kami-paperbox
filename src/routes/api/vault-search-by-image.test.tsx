/**
 * /api/vault/search-by-image 路由级单测（version.server.test.ts 的 probe 先例）。
 *
 * 作用：锁 mount 的 guest 语义（无凭据 401，处理器不可达）、multipart 校验四分支、
 *      handler 对临时库的完整 happy path（命中带 meta 字段与距离；异图空）。
 * 用法：随 pnpm test 的 tsx 段跑（src 下的 .test.tsx 都归该段）。必须 tsx：auth 链的
 *      pglite-dialect.ts 用了 strip-types 不支持的参数属性，进不了 lib 的
 *      strip-types 段——故用 .tsx 后缀搭 tsx 段的车，内容并无 JSX。
 * 为什么整文件动态 import：KAMI_ROOT 必须先于任何 resolveKamiRoot 调用钉进临时目录
 *      （store 单例与 auth secret 全落这里），静态 import 会被提升到赋值之前。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { PNG } from "pngjs";

const root = mkdtempSync(join(tmpdir(), "kami-vault-sbi-route-"));
process.env.KAMI_ROOT = root;
// auth-OFF（Docker 默认形态）：闸门走 LAN-token 分支，裸请求无令牌 → 401。
// 空临时库没有 better-auth 表，auth-ON 会话路径归 e2e（真实库由建库迁移兜住）。
process.env.VITE_AUTH_ENABLED = "false";

const { openVaultStore, getVaultStore } = await import("@/lib/storage/vault-store.server");
const { POST: searchByImage } = await import("@/routes/api/vault-search-by-image");
const { POST: mountedSearchByImage } = await import(
  "../../../app/api/vault/search-by-image/route.ts"
);

const URL = "http://localhost:8080/api/vault/search-by-image";

/** pngjs 产物是 Buffer（ArrayBufferLike 背书）；经 number 构造转成严格 ArrayBuffer 背书，才能进 File/BlobPart。 */
function pngToBytes(img: PNG): Uint8Array<ArrayBuffer> {
  const raw = PNG.sync.write(img);
  const bytes = new Uint8Array(raw.byteLength);
  bytes.set(raw);
  return bytes;
}

/** 左暗右亮渐变 PNG（dhash 全 1）；纯色 128 的对图距离 64。 */
function gradientPng(): Uint8Array<ArrayBuffer> {
  const img = new PNG({ width: 64, height: 64 });
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const i = (64 * y + x) << 2;
      const v = Math.round((x / 63) * 255);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  return pngToBytes(img);
}

const gradient = gradientPng();
const solid = (() => {
  const img = new PNG({ width: 64, height: 64 });
  for (let i = 0; i < 64 * 64; i++) {
    img.data[(i << 2) + 3] = 255; // RGB 全 0：纯黑，与渐变距离最远
  }
  return pngToBytes(img);
})();

function multipartWith(file?: File): Request {
  const form = new FormData();
  if (file) form.set("file", file);
  return new Request(URL, { method: "POST", body: form });
}

test("guest（无凭据）→ 401：withDataPlane 不传 guest，处理器不可达", async () => {
  const res = await mountedSearchByImage(multipartWith());
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "Unauthorized" });
});

test("multipart 校验四分支（照 reverse-search 样板）", async () => {
  const notMultipart = await searchByImage(new Request(URL, { method: "POST" }));
  assert.equal(notMultipart.status, 400);
  assert.equal((await notMultipart.json()).error, "需要上传图片");

  const noFile = await searchByImage(multipartWith());
  assert.equal(noFile.status, 400);
  assert.equal((await noFile.json()).error, "请选择一张图片");

  const oversized = await searchByImage(
    multipartWith(new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.png", { type: "image/png" })),
  );
  assert.equal(oversized.status, 400);
  assert.equal((await oversized.json()).error, "图片超过 8 MB，请缩小后再试");

  const badType = await searchByImage(
    multipartWith(new File([new Uint8Array([1])], "x.txt", { type: "text/plain" })),
  );
  assert.equal(badType.status, 400);
  assert.equal((await badType.json()).error, "只支持 JPEG / PNG / GIF / WebP");
});

test("webp 过类型校验但读不出像素 → 400（接口自校验，不依赖客户端预压）", async () => {
  const webp = await searchByImage(
    multipartWith(new File([new Uint8Array([0x52, 0x49, 0x46, 0x46])], "q.webp", { type: "image/webp" })),
  );
  assert.equal(webp.status, 400);
  assert.equal((await webp.json()).error, "读不出这张图的像素（目前支持 JPEG/PNG）");
});

test("同图 PNG → 200 + matches 带 meta 字段与距离；异图 → 空数组", async () => {
  // 预放一条 yande 同图（同一 KAMI_ROOT，先开先关，路由单例随后打开）
  const pre = openVaultStore(root);
  pre.put(
    {
      key: "yande:9001",
      source: "yande",
      id: "9001",
      title: "同图藏品",
      author: "a",
      authorId: "a1",
      tags: [],
      pageCount: 1,
      savedAt: 1_700_000_000_000,
      bytes: gradient.byteLength,
    },
    [{ bytes: gradient, ext: "png", mime: "image/png" }],
  );
  pre.close();

  const res = await searchByImage(
    multipartWith(new File([gradient], "q.png", { type: "image/png" })),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; matches: Record<string, unknown>[] };
  assert.equal(body.ok, true);
  assert.equal(body.matches.length, 1);
  const m = body.matches[0]!;
  assert.equal(m.key, "yande:9001");
  assert.equal(m.source, "yande");
  assert.equal(m.title, "同图藏品");
  assert.equal(m.hasFile, true);
  assert.equal(m.distance, 0);
  // design §2.1 的响应字段口径
  for (const field of ["key", "source", "id", "title", "author", "pageCount", "bytes", "savedAt", "hasFile", "distance"]) {
    assert.ok(field in m, `matches 缺字段 ${field}`);
  }

  const miss = await searchByImage(
    multipartWith(new File([solid], "q.png", { type: "image/png" })),
  );
  assert.equal(miss.status, 200);
  assert.deepEqual((await miss.json()).matches, []);
});

after(() => {
  try {
    getVaultStore().close();
  } catch {
    /* 单例未开过 */
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
});
