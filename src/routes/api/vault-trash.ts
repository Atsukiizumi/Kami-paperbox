/**
 * 纸篓（软删除回收站）HTTP。
 *
 * 作用：列出已删藏品、单件还原、单件/全部彻底删（真删）。
 * 用法：
 *   GET  /api/vault/trash            { ok, items: VaultMeta&{deletedAt}[], bytes }
 *   POST /api/vault/trash            { action: "restore" | "purge", key?, all?, confirm? }
 *                                    purge 必须 confirm === "purge"（真删不可逆，双确认在后端也设防）。
 * 为什么：删除改软删后，还原与真删需要独立入口；GET/POST 与 /api/vault 同栈走 withDataPlane。
 */
import { parseVaultKey, getVaultStore } from "@/lib/storage/vault-store.server";

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function fail(err: unknown, fallback = "纸篓不可用", status = 500) {
  return json({ ok: false, error: err instanceof Error ? err.message : fallback }, status);
}

export async function GET() {
  try {
    const store = getVaultStore();
    const items = store.trashList();
    return json({ ok: true, items, bytes: items.reduce((sum, item) => sum + (item.bytes || 0), 0) });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      action?: string;
      key?: string;
      all?: boolean;
      confirm?: string;
    } | null;
    if (!body || (body.action !== "restore" && body.action !== "purge")) {
      return json({ ok: false, error: "动作不对" }, 400);
    }
    const store = getVaultStore();
    if (body.action === "restore") {
      if (!body.key || !parseVaultKey(body.key)) return json({ ok: false, error: "无效编号" }, 400);
      const ok = store.restore(body.key);
      return ok ? json({ ok: true, restored: body.key }) : json({ ok: false, error: "纸篓里没有这一条" }, 404);
    }
    // purge：真删。带 key 删单件，all 清空；必须有显式 confirm 字样。
    if (body.confirm !== "purge") return json({ ok: false, error: "缺少确认" }, 400);
    if (body.all) {
      const purged = store.trashPurge();
      return json({ ok: true, purged });
    }
    if (!body.key || !parseVaultKey(body.key)) return json({ ok: false, error: "无效编号" }, 400);
    const purged = store.trashPurge([body.key]);
    return purged > 0
      ? json({ ok: true, purged })
      : json({ ok: false, error: "纸篓里没有这一条" }, 404);
  } catch (err) {
    return fail(err);
  }
}
