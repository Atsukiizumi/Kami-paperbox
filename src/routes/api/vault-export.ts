/**
 * 纸匣导出 HTTP（个人面，E）。
 *
 * 作用：POST {keys, authorAliases?} → 服务端流式 zip（fflate Zip + pull 式
 *      ReadableStream），每次只从磁盘读一页推进压缩（评审 #130：不再预读
 *      整包进内存），按作者分文件夹（规范化 + 用户别名）；包尾写
 *      _skipped.json 记录缺条目/缺文件。
 * 用法：浏览器 fetch POST → res.blob() → 下载。上限 400 keys；别名表由
 *      客户端从设置段随请求带上（≤200 条、键值各 ≤120，见 parseAuthorAliases），
 *      服务端不回读数据库，保持无状态。
 * 为什么 zip 级别 0：原图已是压缩格式，压缩只烧 CPU 不省体积。
 */
import { strToU8, Zip, ZipDeflate } from "fflate";
import { z } from "zod";
import { parseAuthorAliases } from "@/lib/author-name";
import { getVaultStore } from "@/lib/storage/vault-store.server";
import { EXPORT_MAX_KEYS, listExportEntries } from "@/lib/storage/vault-export.server";

/** 可选别名段：形状不对整体忽略（错误语义不变，导出照旧按规范化分夹）。 */
const authorAliasesSchema = z.record(z.string(), z.string()).optional();

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { keys?: unknown; authorAliases?: unknown };
    const keys = Array.isArray(body.keys)
      ? body.keys.filter((k): k is string => typeof k === "string").slice(0, EXPORT_MAX_KEYS)
      : [];
    if (keys.length === 0) {
      return Response.json({ ok: false, error: "没有可导出的条目" }, { status: 400 });
    }
    const aliasesChecked = authorAliasesSchema.safeParse(body.authorAliases);
    const authorAliases = aliasesChecked.success ? parseAuthorAliases(aliasesChecked.data) : {};
    const store = getVaultStore();
    const { items, skipped } = listExportEntries(store, keys, { authorAliases });
    if (items.length === 0) {
      return Response.json({ ok: false, error: "所选条目都没有可打包的原图文件", skipped }, { status: 422 });
    }

    const buffer: Uint8Array[] = [];
    let streamError: unknown = null;
    let closed = false;
    const zip = new Zip((err, chunk, final) => {
      if (err) {
        streamError = err;
        return;
      }
      if (chunk) buffer.push(chunk);
      if (final && !closed) closed = true;
    });

    let idx = 0;
    let zippingDone = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // 每次拉取：先吐已产出的块；没有就推进一格（读一页 → 压一文件）。
        // 磁盘竞态（元数据在、文件没了）记 read-error 跳过，不中断整包。
        while (buffer.length === 0 && !zippingDone) {
          if (idx < items.length) {
            const item = items[idx++]!;
            const page = store.readPage(item.key, item.page);
            if (!page) {
              skipped.push({ key: item.key, reason: "read-error" });
              continue;
            }
            const file = new ZipDeflate(item.name, { level: 0 });
            zip.add(file);
            file.push(new Uint8Array(page.bytes), true);
          } else {
            const manifest = new ZipDeflate("_skipped.json", { level: 6 });
            zip.add(manifest);
            manifest.push(strToU8(JSON.stringify(skipped, null, 2)), true);
            zip.end();
            zippingDone = true;
          }
        }
        while (buffer.length > 0) {
          const chunk = buffer.shift()!;
          if (streamError) {
            controller.error(streamError);
            return;
          }
          controller.enqueue(chunk);
        }
        if (zippingDone) {
          if (streamError) controller.error(streamError);
          else controller.close();
        }
      },
      cancel() {
        /* 调用方断开：fflate 无中止 API，剩余回调入已关闭流为 no-op */
      },
    });

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(stream, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="kami-vault-${stamp}.zip"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : "导出失败" }, { status: 500 });
  }
}
