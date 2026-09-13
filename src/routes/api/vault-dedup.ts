/**
 * 纸匣查重 HTTP（个人面）。
 *
 * 作用：GET 现场重算候选组；POST action=scan 补算缺失哈希（分批 yield）后聚类、
 *      action=dismiss 忽略一对。候选组不落库——忽略/删除后重算即时生效。
 * 为什么不开 guest：查重与处理是收藏管理动作，属个人面（与 /api/vault 同口径）。
 */
import { dhashInfoFromBytesSync } from "@/lib/storage/dhash";
import { clusterDupes, pairKeyOf } from "@/lib/storage/vault-dedup";
import { getVaultStore } from "@/lib/storage/vault-store.server";

const DEFAULT_THRESHOLD = 10;
const SCAN_YIELD_EVERY = 50;

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function GET() {
  try {
    const store = getVaultStore();
    const groups = clusterDupes(store.hashes(), DEFAULT_THRESHOLD, store.dismissedPairs());
    return json({ ok: true, ...groupsSummary(store, groups) });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : "查重不可用" }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const store = getVaultStore();
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      threshold?: unknown;
      a?: unknown;
      b?: unknown;
    };
    if (body.action === "dismiss") {
      const a = typeof body.a === "string" ? body.a : "";
      const b = typeof body.b === "string" ? body.b : "";
      if (!store.get(a) || !store.get(b)) return json({ ok: false, error: "条目不存在" }, 400);
      store.dismissPair(a, b);
      return json({ ok: true, pair: pairKeyOf(a, b) });
    }
    if (body.action !== "scan") return json({ ok: false, error: "未知 action" }, 400);
    const threshold =
      typeof body.threshold === "number" && Number.isFinite(body.threshold) && body.threshold >= 0 && body.threshold <= 64
        ? Math.floor(body.threshold)
        : DEFAULT_THRESHOLD;

    // 补算缺失哈希：只对有首页文件的条目；每 50 条让出事件循环（对齐 sweepCache 的分批模式）
    const hashed = new Set(store.hashes().map((h) => h.key));
    const items = store.list();
    let done = 0;
    for (const item of items) {
      if (!hashed.has(item.key)) {
        const page = store.readPage(item.key, 0);
        if (page) {
          const info = dhashInfoFromBytesSync(new Uint8Array(page.bytes), page.mime);
          if (info) store.putHash(item.key, info.dhash, info.w, info.h);
        }
      }
      done += 1;
      if (done % SCAN_YIELD_EVERY === 0) await new Promise((r) => setImmediate(r));
    }
    const groups = clusterDupes(store.hashes(), threshold, store.dismissedPairs());
    return json({ ok: true, ...groupsSummary(store, groups) });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : "查重不可用" }, 500);
  }
}

function groupsSummary(
  store: ReturnType<typeof getVaultStore>,
  groups: { keys: string[]; maxDistance: number }[],
) {
  return { groups, hashed: store.hashes().length, total: store.list().length };
}
