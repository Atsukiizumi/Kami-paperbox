import { createFileRoute } from "@tanstack/react-router";
import { runReverseSearch } from "@/lib/reverse-search.server";
import { MAX_SEARCH_BYTES, SEARCH_TYPES, parseSearchEngine } from "@/lib/reverse-search";

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/reverse-search")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
        const engine = parseSearchEngine(String(form.get("engine") ?? ""));
        const safeMode = String(form.get("safe") ?? "1") !== "0";
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const result = await runReverseSearch({
            engine,
            bytes,
            filename: file.name || "upload.jpg",
            type: SEARCH_TYPES.has(type) ? type : "image/jpeg",
            safeMode,
          });
          return json({ ok: true, ...result });
        } catch (err) {
          const message = err instanceof Error ? err.message : "搜图失败";
          return json({ ok: false, error: message }, 502);
        }
      },
    },
  },
});
