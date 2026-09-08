/**
 * 热榜快照 HTTP。
 *
 * GET  /api/rankings              健康检查 + 列表（?site &period）
 * GET  /api/rankings?id=          一条快照（含作品）
 * PUT  /api/rankings              { site, period, date, items }
 * DELETE /api/rankings?id=        删一条
 * DELETE /api/rankings?site=      清空该站
 */
import { isSource } from "@/lib/sites";
import type { Source, WorkCard } from "@/lib/types";
import { getRankingStore, rankingStoreHealth, type RankPeriod } from "@/lib/ranking-store.server";

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function isPeriod(v: string): v is RankPeriod {
  return v === "daily" || v === "weekly" || v === "monthly";
}

export async function GET(request: Request) {
        const store = getRankingStore();
        if (!store) return json({ ok: false, error: "热榜库不可用" }, 503);
        const url = new URL(request.url);
        const id = url.searchParams.get("id") ?? "";
        if (id) {
          const snap = store.get(id);
          if (!snap) return json({ ok: false, error: "没有这条榜单" }, 404);
          return json({ ok: true, snapshot: snap });
        }
        const siteRaw = url.searchParams.get("site") ?? "";
        const periodRaw = url.searchParams.get("period") ?? "";
        const site = siteRaw && isSource(siteRaw) ? siteRaw : "";
        const period = periodRaw && isPeriod(periodRaw) ? periodRaw : "";
        return json({ ok: true, health: rankingStoreHealth(), items: store.list(site, period) });
}

export async function PUT(request: Request) {
        const store = getRankingStore();
        if (!store) return json({ ok: false, error: "热榜库不可用" }, 503);
        const body = (await request.json()) as {
          site?: string;
          period?: string;
          date?: string;
          items?: WorkCard[];
        };
        if (!body.site || !isSource(body.site) || body.site === "fanbox" || body.site === "pixiv") {
          return json({ ok: false, error: "站点无效" }, 400);
        }
        if (!body.period || !isPeriod(body.period)) return json({ ok: false, error: "榜单类型无效" }, 400);
        if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
          return json({ ok: false, error: "日期无效" }, 400);
        }
        if (!Array.isArray(body.items) || body.items.length === 0) {
          return json({ ok: false, error: "榜单是空的" }, 400);
        }
        const snap = store.put(body.site as Source, body.period, body.date, body.items.slice(0, 200));
        return json({ ok: true, snapshot: { ...snap, items: undefined, count: snap.count } });
}

export async function DELETE(request: Request) {
        const store = getRankingStore();
        if (!store) return json({ ok: false, error: "热榜库不可用" }, 503);
        const url = new URL(request.url);
        const id = url.searchParams.get("id") ?? "";
        const siteRaw = url.searchParams.get("site") ?? "";
        if (id) {
          store.delete(id);
          return json({ ok: true });
        }
        if (siteRaw && isSource(siteRaw)) {
          store.clearSite(siteRaw);
          return json({ ok: true });
        }
        return json({ ok: false, error: "缺少 id 或 site" }, 400);
}
