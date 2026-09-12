/**
 * 热榜快照（SQLite）。
 *
 * 作用：把各站日/周/月榜按日期永久记下来，之后可选某一天回看。
 * 用法：只在服务端。HTTP 见 `/api/rankings`。
 * 为什么：站点榜单会滚走；纸匣自己存一份，不设条数上限。
 */
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveKamiRoot } from "./proxy.server.ts";
import type { Source, WorkCard } from "./types.ts";

export type RankPeriod = "daily" | "weekly" | "monthly";

export type RankSnapshotMeta = {
  id: string;
  site: Source;
  period: RankPeriod;
  date: string;
  fetchedAt: number;
  count: number;
};

export type RankSnapshot = RankSnapshotMeta & { items: WorkCard[] };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  period TEXT NOT NULL,
  date TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  items TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snap_site_period ON snapshots(site, period, date);
`;

function snapshotId(site: Source, period: RankPeriod, date: string) {
  return `${site}:${period}:${date}`;
}

export function rankingKey(site: Source, period: RankPeriod, date: string): string {
  return snapshotId(site, period, date);
}

type Row = {
  id: string;
  site: string;
  period: string;
  date: string;
  fetched_at: number;
  items: string;
};

function rowMeta(row: Row): RankSnapshotMeta {
  let count = 0;
  try {
    const parsed = JSON.parse(row.items) as unknown;
    count = Array.isArray(parsed) ? parsed.length : 0;
  } catch (err) {
    console.warn("[ranking-store:count] 榜单缓存行损坏（按 0 计）：", err instanceof Error ? err.message : err);
    count = 0;
  }
  return {
    id: row.id,
    site: row.site as Source,
    period: row.period as RankPeriod,
    date: row.date,
    fetchedAt: row.fetched_at,
    count,
  };
}

export function openRankingStore(root = resolveKamiRoot()) {
  const dir = join(root, ".data", "rankings");
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, "rankings.sqlite"));
  db.exec(SCHEMA);
  const upsert = db.prepare(
    "INSERT INTO snapshots(id, site, period, date, fetched_at, items) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at, items=excluded.items",
  );
  const selectOne = db.prepare("SELECT * FROM snapshots WHERE id = ?");
  const selectList = db.prepare(
    "SELECT * FROM snapshots WHERE (? = '' OR site = ?) AND (? = '' OR period = ?) ORDER BY date DESC, fetched_at DESC",
  );
  const remove = db.prepare("DELETE FROM snapshots WHERE id = ?");
  const clearSite = db.prepare("DELETE FROM snapshots WHERE site = ?");

  return {
    put(site: Source, period: RankPeriod, date: string, items: WorkCard[]): RankSnapshot {
      const id = snapshotId(site, period, date);
      const fetchedAt = Date.now();
      upsert.run(id, site, period, date, fetchedAt, JSON.stringify(items));
      return { id, site, period, date, fetchedAt, count: items.length, items };
    },
    get(id: string): RankSnapshot | undefined {
      const row = selectOne.get(id) as Row | undefined;
      if (!row) return undefined;
      let items: WorkCard[] = [];
      try {
        const parsed = JSON.parse(row.items) as unknown;
        if (Array.isArray(parsed)) items = parsed as WorkCard[];
      } catch (err) {
        console.warn("[ranking-store:parse-items] 榜单缓存行损坏（按空列表）：", err instanceof Error ? err.message : err);
        items = [];
      }
      return { ...rowMeta(row), items };
    },
    list(site?: Source | "", period?: RankPeriod | ""): RankSnapshotMeta[] {
      const rows = selectList.all(site ?? "", site ?? "", period ?? "", period ?? "") as Row[];
      return rows.map(rowMeta);
    },
    delete(id: string) {
      remove.run(id);
    },
    clearSite(site: Source) {
      clearSite.run(site);
    },
    close() {
      db.close();
    },
  };
}

let cached: ReturnType<typeof openRankingStore> | null = null;

// TD-39：open 失败后冷却——坏目录时每次 GET 都重试 open + warn，纯噪音。
const OPEN_COOLDOWN_MS = 5 * 60_000;
let openCooldownUntil = 0;

export function getRankingStore() {
  if (cached) return cached;
  if (Date.now() < openCooldownUntil) return null;
  try {
    cached = openRankingStore();
    return cached;
  } catch (err) {
    openCooldownUntil = Date.now() + OPEN_COOLDOWN_MS;
    console.warn("[ranking-store:open] 打开榜单存储失败（榜单归档停用，5 分钟内不再重试）：", err instanceof Error ? err.message : err);
    return null;
  }
}

export function rankingStoreHealth(): { ok: boolean } {
  return { ok: Boolean(getRankingStore()) };
}
