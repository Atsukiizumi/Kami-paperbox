/**
 * 浏览器 ↔ Node 纸匣同步。
 *
 * 作用：收入时把作品推到本机 Node 目录；纸匣页优先读服务器列表，失败再读 IndexedDB。
 * 用法：pushVaultToServer / pushVaultMetaToServer / listServerVault / fetchServerVaultBlob / deleteServerVault。
 * 为什么：预览和 PWA 仍需要 IDB（关服务器也能看缓存）；真正扛量的是 Node 写的 SQLite + 文件。
 */
import type { VaultMeta } from "../types.ts";
import type { VaultQuery } from "./vault-query.ts";
import { extFromNameOrType } from "../ugoira-meta.ts";

export type ServerVaultList = {
  ok: boolean;
  available: boolean;
  items: VaultMeta[];
  authors: string[];
  totals: { count: number; bytes: number; dir: string };
};

export function vaultPageUrl(key: string, page = 0): string {
  return `/api/vault?key=${encodeURIComponent(key)}&page=${page}`;
}

async function asJson<T>(res: Response): Promise<T | null> {
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function listServerVault(q: VaultQuery = {}): Promise<ServerVaultList | null> {
  const params = new URLSearchParams();
  if (q.text) params.set("text", q.text);
  if (q.source && q.source !== "all") params.set("source", q.source);
  if (q.author) params.set("author", q.author);
  const qs = params.toString();
  try {
    const res = await fetch(`/api/vault${qs ? `?${qs}` : ""}`, { cache: "no-store" });
    const body = await asJson<ServerVaultList>(res);
    if (!body?.available) return null;
    return body;
  } catch {
    return null;
  }
}

export async function fetchServerVaultBlob(key: string, page: number): Promise<Blob | undefined> {
  try {
    const res = await fetch(`/api/vault?key=${encodeURIComponent(key)}&page=${page}`, { cache: "force-cache" });
    if (!res.ok) return undefined;
    const buf = await res.arrayBuffer();
    const type = res.headers.get("content-type") || "application/octet-stream";
    return new Blob([buf], { type });
  } catch {
    return undefined;
  }
}

export async function pushVaultMetaToServer(meta: VaultMeta): Promise<VaultMeta | null> {
  try {
    const res = await fetch("/api/vault", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ meta }),
    });
    const body = await asJson<{ ok: boolean; item?: VaultMeta }>(res);
    return body?.ok && body.item ? body.item : null;
  } catch {
    return null;
  }
}

export async function pushVaultToServer(
  meta: VaultMeta,
  pages: { blob: Blob; ext?: string }[],
): Promise<VaultMeta | null> {
  const form = new FormData();
  form.set("meta", JSON.stringify(meta));
  pages.forEach((page, i) => {
    const ext = page.ext ?? extFromNameOrType(undefined, page.blob.type);
    form.set(`page_${i}`, page.blob, `${i}.${ext}`);
  });
  try {
    const res = await fetch("/api/vault", { method: "PUT", body: form });
    const body = await asJson<{ ok: boolean; item?: VaultMeta }>(res);
    return body?.ok && body.item ? body.item : null;
  } catch {
    return null;
  }
}

export async function patchServerVault(
  key: string,
  patch: Pick<VaultMeta, "relativePath" | "folderLabel">,
): Promise<boolean> {
  try {
    const res = await fetch("/api/vault", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, ...patch }),
    });
    const body = await asJson<{ ok: boolean }>(res);
    return Boolean(body?.ok);
  } catch {
    return false;
  }
}

export async function deleteServerVault(key: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/vault?key=${encodeURIComponent(key)}`, { method: "DELETE" });
    const body = await asJson<{ ok: boolean }>(res);
    return Boolean(body?.ok);
  } catch {
    return false;
  }
}

export type ServerTrashItem = VaultMeta & { deletedAt: number };

export type ServerTrashList = {
  ok: boolean;
  items: ServerTrashItem[];
  bytes: number;
};

/** 纸篓列表（软删除的藏品）。服务端不可达返回 null（纸篓是纯服务端能力，此时入口直接隐身）。 */
export async function listServerTrash(): Promise<ServerTrashList | null> {
  try {
    const res = await fetch("/api/vault/trash", { cache: "no-store" });
    return await asJson<ServerTrashList>(res);
  } catch {
    return null;
  }
}

export async function restoreServerTrash(key: string): Promise<boolean> {
  try {
    const res = await fetch("/api/vault/trash", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "restore", key }),
    });
    const body = await asJson<{ ok: boolean }>(res);
    return Boolean(body?.ok);
  } catch {
    return false;
  }
}

/** 彻底删（真删）：key 单件 / all 清空；confirm 与服务端防误触字段对齐。 */
export async function purgeServerTrash(opts: { key?: string; all?: true }): Promise<boolean> {
  try {
    const res = await fetch("/api/vault/trash", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "purge", ...opts, confirm: "purge" }),
    });
    const body = await asJson<{ ok: boolean }>(res);
    return Boolean(body?.ok);
  } catch {
    return false;
  }
}
