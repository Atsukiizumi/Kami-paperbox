/**
 * 本机 Node 纸匣 HTTP。
 *
 * 作用：列出/搜索目录、读写某一页原图、收入、删除。
 * 用法：
 *   GET  /api/vault              健康检查 + 列表（?text &source &author）
 *   GET  /api/vault?key&page     某一页文件
 *   PUT  /api/vault              FormData：meta JSON + page_0… 文件
 *   PATCH /api/vault             { key, relativePath?, folderLabel? }
 *   DELETE /api/vault?key=
 * 为什么：浏览器碰不到 `.data/vault`，必须由 Node 进程写盘。
 */
import { createFileRoute } from "@tanstack/react-router";
import { extFromNameOrType } from "@/lib/ugoira-meta";
import { isSource } from "@/lib/sites";
import type { Source, VaultMeta } from "@/lib/types";
import { getVaultStore, parseVaultKey, vaultStoreHealth } from "@/lib/vault-store.server";
import type { VaultQuery } from "@/lib/vault-query";

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function fail(err: unknown, fallback = "纸匣目录不可用", status = 500) {
  return json({ ok: false, error: err instanceof Error ? err.message : fallback }, status);
}

function queryOf(url: URL): VaultQuery {
  const text = url.searchParams.get("text") ?? undefined;
  const sourceRaw = url.searchParams.get("source") ?? "all";
  const author = url.searchParams.get("author") ?? undefined;
  const source = sourceRaw === "all" || isSource(sourceRaw) ? sourceRaw : "all";
  return { text, source: source as Source | "all", author };
}

function metaFromUnknown(raw: unknown): VaultMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const source = typeof o.source === "string" ? o.source : "";
  const id = typeof o.id === "string" ? o.id : "";
  const key = typeof o.key === "string" ? o.key : `${source}:${id}`;
  if (!parseVaultKey(key)) return null;
  const tags = Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === "string") : [];
  return {
    key,
    source: source as Source,
    id,
    title: typeof o.title === "string" ? o.title : "无题",
    author: typeof o.author === "string" ? o.author : "",
    authorId: typeof o.authorId === "string" ? o.authorId : "",
    tags,
    pageCount: typeof o.pageCount === "number" ? o.pageCount : 0,
    savedAt: typeof o.savedAt === "number" ? o.savedAt : Date.now(),
    bytes: typeof o.bytes === "number" ? o.bytes : 0,
    relativePath: typeof o.relativePath === "string" ? o.relativePath : undefined,
    folderLabel: typeof o.folderLabel === "string" ? o.folderLabel : undefined,
  };
}

export const Route = createFileRoute("/api/vault")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const key = url.searchParams.get("key");
        const pageRaw = url.searchParams.get("page");
        try {
          if (key && pageRaw !== null) {
            const parsed = parseVaultKey(key);
            if (!parsed) return json({ ok: false, error: "无效编号" }, 400);
            const page = Number(pageRaw);
            if (!Number.isInteger(page) || page < 0 || page > 200) {
              return json({ ok: false, error: "页码不对" }, 400);
            }
            const file = getVaultStore().readPage(key, page);
            if (!file) return json({ ok: false, error: "没有这一页" }, 404);
            return new Response(new Uint8Array(file.bytes), {
              headers: {
                "content-type": file.mime || "application/octet-stream",
                "cache-control": "private, max-age=3600",
                "x-file-ext": file.ext,
              },
            });
          }
          const health = vaultStoreHealth();
          if (!health.available) return json({ ok: false, available: false, items: [] });
          const store = getVaultStore();
          const q = queryOf(url);
          const items = store.list(q);
          return json({
            ok: true,
            available: true,
            items,
            authors: store.authors(),
            totals: store.stats(),
            query: q,
          });
        } catch (err) {
          return fail(err);
        }
      },
      PUT: async ({ request }) => {
        try {
          const form = await request.formData();
          let metaRaw: unknown = form.get("meta");
          if (typeof metaRaw === "string") {
            try {
              metaRaw = JSON.parse(metaRaw) as unknown;
            } catch {
              return json({ ok: false, error: "meta 不是 JSON" }, 400);
            }
          }
          const meta = metaFromUnknown(metaRaw);
          if (!meta) return json({ ok: false, error: "缺少作品信息" }, 400);
          const pages: { bytes: Uint8Array; ext: string; mime: string }[] = [];
          for (let i = 0; i < 80; i += 1) {
            const file = form.get(`page_${i}`);
            if (!(file instanceof File)) break;
            const buf = new Uint8Array(await file.arrayBuffer());
            pages.push({
              bytes: buf,
              ext: extFromNameOrType(file.name, file.type),
              mime: file.type || "application/octet-stream",
            });
          }
          if (pages.length === 0) return json({ ok: false, error: "没有图片" }, 400);
          const saved = getVaultStore().put(meta, pages);
          return json({ ok: true, item: saved });
        } catch (err) {
          return fail(err, "写入失败");
        }
      },
      PATCH: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            key?: string;
            relativePath?: string;
            folderLabel?: string;
          };
          if (!body.key || !parseVaultKey(body.key)) {
            return json({ ok: false, error: "无效编号" }, 400);
          }
          const item = getVaultStore().patch(body.key, {
            relativePath: body.relativePath,
            folderLabel: body.folderLabel,
          });
          if (!item) return json({ ok: false, error: "没有这条记录" }, 404);
          return json({ ok: true, item });
        } catch (err) {
          return fail(err);
        }
      },
      DELETE: async ({ request }) => {
        const url = new URL(request.url);
        const key = url.searchParams.get("key") ?? "";
        if (!parseVaultKey(key)) return json({ ok: false, error: "无效编号" }, 400);
        try {
          const ok = getVaultStore().remove(key);
          return json({ ok, deleted: ok });
        } catch (err) {
          return fail(err);
        }
      },
    },
  },
});
