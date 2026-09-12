/**
 * 纸匣导出 HTTP（个人面，E）。
 *
 * 作用：POST {keys} → 服务端流式 zip（fflate Zip 边压边吐，不整包进内存），
 *      按作者分文件夹；包尾写 _skipped.json 记录缺条目/缺文件。
 * 用法：浏览器 fetch POST → res.blob() → 下载。上限 400 keys。
 * 为什么 zip 级别 0：原图已是压缩格式，压缩只烧 CPU 不省体积。
 */
import { strToU8, Zip, ZipDeflate } from "fflate";
import { getVaultStore } from "@/lib/vault-store.server";
import { buildExportEntries, EXPORT_MAX_KEYS } from "@/lib/vault-export.server";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { keys?: unknown };
    const keys = Array.isArray(body.keys)
      ? body.keys.filter((k): k is string => typeof k === "string").slice(0, EXPORT_MAX_KEYS)
      : [];
    if (keys.length === 0) {
      return Response.json({ ok: false, error: "没有可导出的条目" }, { status: 400 });
    }
    const store = getVaultStore();
    const { entries, skipped } = buildExportEntries(store, keys);
    if (entries.length === 0) {
      return Response.json({ ok: false, error: "所选条目都没有可打包的原图文件", skipped }, { status: 422 });
    }

    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let zipErr: unknown = null;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        const zip = new Zip((err, chunk, final) => {
          if (err) {
            zipErr = err;
            try {
              controller.error(err);
            } catch {
              /* 已关闭 */
            }
            return;
          }
          try {
            if (chunk) controller.enqueue(chunk);
            if (final) controller.close();
          } catch {
            /* 调用方断开：继续喂完剩余回调，流关闭后入 chunk 无害 */
          }
        });
        // fflate 异步处理队列：回调时 controller 已就绪（上面 start 同步赋值）
        for (const entry of entries) {
          const file = new ZipDeflate(entry.name, { level: 0 });
          zip.add(file);
          file.push(entry.bytes, true);
        }
        const manifest = new ZipDeflate("_skipped.json", { level: 6 });
        zip.add(manifest);
        manifest.push(strToU8(JSON.stringify(skipped, null, 2)), true);
        zip.end();
        if (zipErr) throw zipErr;
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
