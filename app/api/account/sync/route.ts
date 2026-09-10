/**
 * 应用账号的设置同步。
 *
 * 作用：登录应用账号后，把「备份」格式的整份设置（各图站 Cookie、词表、纸匣索引、
 *      历史）存到服务端；换浏览器登录同一账号即可恢复。
 * 用法：GET 拉取 / POST 推送。没有有效会话一律 401。
 * 为什么：备份文件要手动导出导入；这份挂在账号下，登录就带回来。数据只存本机
 *        `.data/pglite`，按 user_id 隔离，不混用。
 */
import { getSessionUser, UnauthorizedError } from "@/lib/auth/verify.server";
import { parseBackup } from "@/lib/backup";
import { ensureDbReady, getSql } from "@/lib/db";
import { scheduleSnapshotDump } from "@/lib/db-snapshot.server";
import { withRequest } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 备份 JSON 上限：词表和纸匣索引加起来一般 < 1MB，2MB 足够并挡住误传
 * （string.length 数的是 UTF-16 码元，全 CJK 载荷实际字节约两倍于此）。
 */
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

async function requireUserId(): Promise<string> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user.id;
}

function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
}

export const GET = withRequest(async (request: Request) => {
  await ensureDbReady();
  try {
    const userId = await requireUserId();
    const sql = await getSql();
    const rows = await sql<{ payload: unknown; exported_at: string }>`select payload, exported_at from user_sync where user_id = ${userId}`;
    const row = rows[0];
    return Response.json(
      { payload: row ? row.payload : null, exportedAt: row ? Number(row.exported_at) : null },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorized();
    const message = err instanceof Error ? err.message : "读取失败";
    return Response.json({ error: message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
});

export const POST = withRequest(async (request: Request) => {
  await ensureDbReady();
  try {
    const userId = await requireUserId();
    const raw = await request.text();
    if (!raw || raw.length > MAX_PAYLOAD_BYTES) {
      return Response.json({ error: "payload too large" }, { status: 413, headers: { "cache-control": "no-store" } });
    }
    let parsed: { exportedAt?: unknown };
    try {
      parsed = JSON.parse(raw) as { exportedAt?: unknown };
    } catch {
      return Response.json({ error: "不是 JSON" }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    // SEC-09：载荷必须是一份合法「备份」——挡住任意 JSON 污染 user_sync
    // （校验通过后仍存原文，GET→applyBackup 的字节与客户端所发一致）。
    const check = parseBackup(parsed);
    if (!check.ok) {
      return Response.json({ error: `同步载荷不合法：${check.error}` }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    const exportedAt = typeof parsed.exportedAt === "number" && Number.isFinite(parsed.exportedAt) ? parsed.exportedAt : Date.now();
    const sql = await getSql();
    await sql`
      insert into user_sync (user_id, payload, exported_at, updated_at)
      values (${userId}, ${raw}::jsonb, ${String(exportedAt)}, now())
      on conflict (user_id) do update
        set payload = excluded.payload,
            exported_at = excluded.exported_at,
            updated_at = now()
    `;
    scheduleSnapshotDump();
    return Response.json({ ok: true, exportedAt }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorized();
    const message = err instanceof Error ? err.message : "保存失败";
    return Response.json({ error: message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
});
