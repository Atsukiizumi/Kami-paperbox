/**
 * 以图搜匣 HTTP（个人面）。
 *
 * 作用：收一张图，用与入库同函数算 dhash，对纸匣全表做近邻扫描，返回阈值内
 *      条目 + 距离（升序，topK 截断）。
 * 用法：POST /api/vault/search-by-image，multipart 字段 file。客户端上传前已过
 *      prepareSearchImage（长边 768 的 JPEG），接口不依赖该前提（自校验）；
 *      匹配判定核心在 nearestByDhash（纯函数直测，见 vault-cross-source.test.ts）。
 * 为什么不开 guest：搜的是用户自己的纸匣，属个人面（与 /api/vault 同口径）；
 *      访客 401 由 withDataPlane 映射，前端归 unavailable 整块隐藏。
 */
import { MAX_SEARCH_BYTES, SEARCH_TYPES } from "@/lib/reverse-search";
import { dhashInfoFromBytesSync } from "@/lib/storage/dhash";
import { SEARCH_BY_IMAGE_TOP_K, nearestByDhash } from "@/lib/storage/vault-cross-source";
import { getVaultStore } from "@/lib/storage/vault-store.server";

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  // multipart 校验照抄 reverse-search.ts 的样板：非 multipart / 空文件 / 8MB / 类型
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) {
    return json({ ok: false, error: "需要上传图片" }, 400);
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "读不到表单" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return json({ ok: false, error: "请选择一张图片" }, 400);
  }
  if (file.size > MAX_SEARCH_BYTES) {
    return json({ ok: false, error: "图片超过 8 MB，请缩小后再试" }, 400);
  }
  const type = file.type || "image/jpeg";
  if (type && !SEARCH_TYPES.has(type) && !type.startsWith("image/")) {
    return json({ ok: false, error: "只支持 JPEG / PNG / GIF / WebP" }, 400);
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // 与入库同函数（vault-store put 的哈希来源），口径必然一致；
    // webp / 坏字节读不出像素 → 400（解码器只认 png/jpeg）
    const info = dhashInfoFromBytesSync(bytes, type);
    if (!info) {
      return json({ ok: false, error: "读不出这张图的像素（目前支持 JPEG/PNG）" }, 400);
    }
    const store = getVaultStore();
    const matches = nearestByDhash(store.hashes(), info.dhash, { limit: SEARCH_BY_IMAGE_TOP_K })
      .flatMap((m) => {
        const meta = store.get(m.key);
        if (!meta) return []; // 404 条目跳过（哈希行与目录行的防御性错位）
        return [
          {
            key: meta.key,
            source: meta.source,
            id: meta.id,
            title: meta.title,
            author: meta.author,
            pageCount: meta.pageCount,
            bytes: meta.bytes,
            savedAt: meta.savedAt,
            hasFile: meta.hasFile,
            distance: m.distance,
          },
        ];
      });
    return json({ ok: true, matches });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : "搜匣不可用" }, 500);
  }
}
