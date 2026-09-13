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

test("snapshot round-trips FK child tables (session/account reference user)", async () => {
  // 字母序快照里 account/session 排在 user 前；restore 必须先插父表，
  // 否则 FK 违反的行会被静默吞掉——重启丢登录态（TD-19 修复的回归面）。
  const pgA = await openMigrated();
  const sqlA = toSql(pgA);
  await sqlA.query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1,$2,$3,$4)`,
    ["u9", "Test", "t@example.com", true],
  );
  await sqlA.query(
    `insert into "session" ("id", "expiresAt", "token", "userId", "updatedAt") values ($1,$2,$3,$4,$5)`,
    // 0001 里 session."updatedAt" 没有 default，必须显式给值
    ["s9", "2099-01-01T00:00:00Z", "tok-9", "u9", "2026-09-11T00:00:00Z"],
  );
  await sqlA.query(
    `insert into "account" ("id", "accountId", "providerId", "userId", "updatedAt") values ($1,$2,$3,$4,$5)`,
    ["a9", "acc-9", "credential", "u9", "2026-09-11T00:00:00Z"],
  );
  const snap = JSON.parse(JSON.stringify(await capture(sqlA))) as Snapshot;
  assert.ok(snap.tables.user && snap.tables.session && snap.tables.account);
  await pgA.close();

  const pgB = await openMigrated();
  const sqlB = toSql(pgB);
  await restore(sqlB, snap);
  const users = await sqlB.query(`select count(*)::int as n from "user"`);
  const sessions = await sqlB.query(`select count(*)::int as n from "session"`);
  const accounts = await sqlB.query(`select count(*)::int as n from "account"`);
  assert.equal(users[0]?.n, 1, "user 必须恢复");
  assert.equal(sessions[0]?.n, 1, "session 必须恢复（FK 子表）");
  assert.equal(accounts[0]?.n, 1, "account 必须恢复（FK 子表）");
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

test("restore reports rows that can never come back, instead of swallowing them", async () => {
  // TD-22：快照里出现「恢复不了」的行（此处：不存在的表；实际事故面是
  // schema 漂移/约束违约的 session 行）时，restore 必须把失败行报出来——
  // 旧实现只 console.warn，随后 dumpNow 覆盖快照，行就这么静默没了。
  const pg = await openMigrated();
  const sql = toSql(pg);
  const snap: Snapshot = {
    at: Date.now(),
    tables: {
      user: [{ id: "u-ok", name: "Ok", email: "ok@example.com", emailVerified: true }],
      session: [
        { id: "s-orphan", expiresAt: "2099-01-01T00:00:00Z", token: "tok-x", userId: "u-missing", updatedAt: "2026-09-12T00:00:00Z" },
      ],
    },
  };
  const failures = await restore(sql, snap);
  assert.equal(failures.length, 1, "孤儿 session 行必须被报告");
  assert.equal(failures[0]?.table, "session");
  assert.match(failures[0]?.error ?? "", /foreign key|violates/i);
  // 好行不受影响：仍正常恢复
  const users = await sql.query<{ n: number }>(`select count(*)::int as n from "user"`);
  assert.equal(users[0]?.n, 1);
  await pg.close();
});
