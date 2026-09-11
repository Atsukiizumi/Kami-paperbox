/**
 * TD-19 回归：分段同步数据（user_sync_segments / user_sync_meta）必须在
 * 「写入 → 快照导出 → 新内存库恢复」链路里存活。旧硬编码 TABLES 漏掉这两张表，
 * PGlite 形态重启即丢。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { capture, restore, type Snapshot } from "./db-snapshot.server.ts";
import type { Sql } from "./db.ts";

// 与 db.ts 保持一致的驱动解析（int8 -> number 等），否则快照含 BigInt 会炸 JSON。
const OID_INT8 = 20;
const OID_DATE = 1082;
const OID_INTERVAL = 1186;

function toSql(pg: PGlite): Sql {
  return {
    async query<T>(text: string, params?: unknown[]) {
      const result = await pg.query<T>(text, params);
      return result.rows;
    },
  } as Sql;
}

async function openMigrated() {
  const pg = new PGlite({
    parsers: {
      [OID_INT8]: Number,
      [OID_DATE]: (v: string) => v,
      [OID_INTERVAL]: (v: string) => v,
    },
  });
  await pg.waitReady;
  await pg.exec(
    "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const dir = join(process.cwd(), "migrations");
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(join(dir, name), "utf8"));
  }
  return pg;
}

test("snapshot round-trips user_sync_segments and user_sync_meta", async () => {
  // 进程 A：写入分段同步数据并导出快照（JSON 序列化一次，模拟落盘）。
  const pgA = await openMigrated();
  const sqlA = toSql(pgA);
  await sqlA.query(
    "insert into user_sync_segments (user_id, segment, payload, exported_at) values ($1,$2,$3::jsonb,$4),($1,$5,$6::jsonb,$7)",
    ["u1", "sites", JSON.stringify({ pixiv: 1 }), "100", "tags", JSON.stringify({ list: [1, 2] }), "100"],
  );
  await sqlA.query(
    "insert into user_sync_meta (user_id, kdf_salt) values ($1,$2)",
    ["u1", "salt-abc"],
  );
  const snap = JSON.parse(JSON.stringify(await capture(sqlA))) as Snapshot;
  assert.ok(snap.tables.user_sync_segments, "快照必须包含 user_sync_segments");
  assert.ok(snap.tables.user_sync_meta, "快照必须包含 user_sync_meta");
  assert.ok(snap.tables.session, "原有表仍被覆盖");
  await pgA.close();

  // 进程 B（重启后的新内存库）：迁移后恢复，分段数据不丢。
  const pgB = await openMigrated();
  const sqlB = toSql(pgB);
  await restore(sqlB, snap);
  const segs = await sqlB.query<{ segment: string; payload: { pixiv?: number } }>(
    "select segment, payload from user_sync_segments where user_id = 'u1' order by segment",
  );
  assert.deepEqual(segs.map((s) => s.segment), ["sites", "tags"]);
  assert.equal(segs[0]?.payload.pixiv, 1);
  const meta = await sqlB.query<{ kdf_salt: string }>(
    "select kdf_salt from user_sync_meta where user_id = 'u1'",
  );
  assert.equal(meta[0]?.kdf_salt, "salt-abc");
  await pgB.close();
});

test("capture picks up tables not in any hardcoded list", async () => {
  const pg = await openMigrated();
  const sql = toSql(pg);
  await pg.exec("create table some_future_table (id text primary key, payload jsonb)");
  const snap = await capture(sql);
  assert.ok(snap?.tables.some_future_table, "新增表应自动进快照");
  assert.ok(!("_migrations" in snap!.tables), "_migrations 不进快照");
  await pg.close();
});
