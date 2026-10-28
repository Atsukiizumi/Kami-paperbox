import { runReverseSearchAll } from "@/lib/reverse-search.server";
import { MAX_SEARCH_BYTES, SEARCH_TYPES } from "@/lib/reverse-search";

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return rest.join("=");
      }
    }
  }
  return undefined;
}

/** kami_danbooru 存的是 JSON（login + apiKey）。没填或坏了就当匿名。 */
function readDanbooru(header: string | null): { login: string; apiKey: string } | undefined {
  const raw = readCookie(header, "kami_danbooru");
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { login?: unknown; apiKey?: unknown };
    const login = typeof parsed.login === "string" ? parsed.login : "";
    const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey : "";
    if (!login || !apiKey) return undefined;
    return { login, apiKey };
  } catch {
    return undefined;
  }
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
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
        const safeMode = String(form.get("safe") ?? "1") !== "0";
        const apiKey = String(form.get("apiKey") ?? "").trim().slice(0, 80);
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const result = await runReverseSearchAll({
            bytes,
            filename: file.name || "upload.jpg",
            type: SEARCH_TYPES.has(type) ? type : "image/jpeg",
            safeMode,
            apiKey: apiKey || undefined,
            danbooru: readDanbooru(request.headers.get("cookie")),
          });
          return json({ ok: true, ...result });
        } catch (err) {
          const message = err instanceof Error ? err.message : "搜图失败";
          return json({ ok: false, error: message }, 502);
        }
}
