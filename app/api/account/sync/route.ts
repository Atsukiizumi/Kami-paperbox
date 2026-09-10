/**
 * 应用账号的设置同步（分段 + 加密，docs/17 第二刀）。
 *
 * 作用：登录应用账号后，把设置 / 纸匣目录 / 词表 / 浏览历史四「段」分别存到
 *      服务端，各自带 exportedAt（LWW 粒度到段，修 TD-09 多设备互相覆盖）；
 *      设置段含图站凭据时以 CipherBox 密文形态落库（SEC-03：磁盘 / 快照
 *      泄露拿不到会话，密钥由账号密码派生，只在登录瞬间留在浏览器）。
 * 用法：GET 拉取全部段 + 旧单行兼容数据 + KDF salt；POST 分段推送
 *      （{ segment, exportedAt, payload }），旧整份格式仍接受（过渡期），
 *      action:"kdf-salt" 确保每用户 salt 存在并返回。没有有效会话一律 401。
 * 为什么：旧实现整载荷 LWW——两台设备谁后推谁全赢，另一台的词表 / 历史
 *        凭空蒸发；且 payload 明文躺在 .data 里。
 */
import { randomBytes } from "node:crypto";
import { getSessionUser, UnauthorizedError } from "@/lib/auth/verify.server";
import { parseBackup, parseVaultRecords } from "@/lib/backup";
import { ensureDbReady, getSql } from "@/lib/db";
import { scheduleSnapshotDump } from "@/lib/db-snapshot.server";
import { withRequest } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 单段上限：词表和纸匣索引一般远小于此；string.length 是 UTF-16 码元。 */
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

const SEGMENTS = new Set(["settings", "vault", "lexicon", "history"]);

async function requireUserId(): Promise<string> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user.id;
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function unauthorized() {
  return json({ error: "Unauthorized" }, 401);
}

/** 段载荷形状（SEC-09 的分段版）：cipher 容器或 plain 数据，按段校验内容。 */
function validateSegment(segment: string, payload: unknown): string | null {
  if (!SEGMENTS.has(segment)) return "未知分段";
  const rec = payload as { kind?: unknown; box?: unknown; data?: unknown; credsOmitted?: unknown } | null;
  if (!rec || typeof rec !== "object") return "分段载荷不是对象";
  if (rec.kind === "cipher") {
    const box = rec.box as Record<string, unknown> | null;
    if (!box || typeof box !== "object") return "cipher 缺容器";
    if (box.v !== 1 || box.kdf !== "PBKDF2-SHA256") return "cipher 格式不对";
    for (const key of ["salt", "iv", "ct"]) {
      if (typeof box[key] !== "string") return `cipher.${key} 缺失`;
    }
    // iter 数字（crypto-box 产出）或纯数字字符串都收
    if (typeof box.iter !== "number" || !Number.isFinite(box.iter)) {
      if (typeof box.iter !== "string" || !/^\d+$/.test(box.iter)) return "cipher.iter 非数字";
    }
    return null;
  }
  if (rec.kind !== "plain") return "分段缺少 kind";
  if (typeof rec.credsOmitted !== "undefined" && typeof rec.credsOmitted !== "boolean") return "credsOmitted 非布尔";
  const data = rec.data;
  try {
    if (segment === "vault") parseVaultRecords(Array.isArray(data) ? data : []);
    if (segment === "history" && data && typeof data === "object" && !Array.isArray((data as { items?: unknown }).items) && (data as { items?: unknown }).items !== undefined) {
      return "history.items 不是数组";
    }
    // settings / lexicon 只做结构级检查（对象即可），细部由客户端 parse 时兜
    if ((segment === "settings" || segment === "lexicon") && (data === null || typeof data !== "object" || Array.isArray(data))) {
      return "data 不是对象";
    }
  } catch {
    return "data 内容不合法";
  }
  return null;
}

export const GET = withRequest(async (request: Request) => {
  await ensureDbReady();
  try {
    const userId = await requireUserId();
    const sql = await getSql();
    const [segments, legacy, meta] = await Promise.all([
      sql<{ segment: string; payload: unknown; exported_at: string }>`select segment, payload, exported_at from user_sync_segments where user_id = ${userId}`,
      sql<{ payload: unknown; exported_at: string }>`select payload, exported_at from user_sync where user_id = ${userId}`,
      sql<{ kdf_salt: string }>`select kdf_salt from user_sync_meta where user_id = ${userId}`,
    ]);
    const out: Record<string, { payload: unknown; exportedAt: number }> = {};
    for (const row of segments) out[row.segment] = { payload: row.payload, exportedAt: Number(row.exported_at) || 0 };
    return json({
      segments: out,
      legacy: legacy[0] ? { payload: legacy[0].payload, exportedAt: Number(legacy[0].exported_at) || 0 } : null,
      kdfSalt: meta[0]?.kdf_salt ?? null,
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorized();
    return json({ error: err instanceof Error ? err.message : "读取失败" }, 500);
  }
});

export const POST = withRequest(async (request: Request) => {
  await ensureDbReady();
  try {
    const userId = await requireUserId();
    const raw = await request.text();
    if (!raw || raw.length > MAX_PAYLOAD_BYTES) return json({ error: "payload too large" }, 413);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return json({ error: "不是 JSON" }, 400);
    }

    // KDF salt：首次登录时由客户端请求，服务端随机生成并固定
    if (body.action === "kdf-salt") {
      const sql = await getSql();
      const salt = randomBytes(16).toString("base64");
      const rows = await sql<{ kdf_salt: string }>`
        insert into user_sync_meta (user_id, kdf_salt) values (${userId}, ${salt})
        on conflict (user_id) do nothing
        returning kdf_salt`;
      const existing = rows[0]?.kdf_salt ?? (await sql<{ kdf_salt: string }>`select kdf_salt from user_sync_meta where user_id = ${userId}`)[0]?.kdf_salt ?? salt;
      return json({ ok: true, kdfSalt: existing });
    }

    // 分段推送
    if (typeof body.segment === "string") {
      const invalid = validateSegment(body.segment, body.payload);
      if (invalid) return json({ error: `分段不合法：${invalid}` }, 400);
      const exportedAt =
        typeof body.exportedAt === "number" && Number.isFinite(body.exportedAt) ? body.exportedAt : Date.now();
      const sql = await getSql();
      await sql`
        insert into user_sync_segments (user_id, segment, payload, exported_at, updated_at)
        values (${userId}, ${body.segment}, ${JSON.stringify(body.payload)}::jsonb, ${String(exportedAt)}, now())
        on conflict (user_id, segment) do update
          set payload = excluded.payload,
              exported_at = excluded.exported_at,
              updated_at = now()`;
      scheduleSnapshotDump();
      return json({ ok: true, exportedAt });
    }

    // 过渡期：旧整份备份格式（parseBackup 校验，写 legacy 单行）
    const check = parseBackup(body);
    if (!check.ok) return json({ error: `同步载荷不合法：${check.error}` }, 400);
    const exportedAt = typeof body.exportedAt === "number" && Number.isFinite(body.exportedAt) ? body.exportedAt : Date.now();
    const sql = await getSql();
    await sql`
      insert into user_sync (user_id, payload, exported_at, updated_at)
      values (${userId}, ${raw}::jsonb, ${String(exportedAt)}, now())
      on conflict (user_id) do update
        set payload = excluded.payload,
            exported_at = excluded.exported_at,
            updated_at = now()`;
    scheduleSnapshotDump();
    return json({ ok: true, exportedAt });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorized();
    return json({ error: err instanceof Error ? err.message : "保存失败" }, 500);
  }
});
