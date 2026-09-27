/**
 * 云备份 HTTP。
 *
 * 作用：连接/换云（PUT target，probe 通过才落盘）、改定时配置（PUT config，
 *      enabled 默认 false——连接 ≠ 开启）、断开（DELETE，云端数据不动）、
 *      测试连接 / 立即备份（POST）。
 * 用法：
 *   GET    /api/vault/cloud-backup        { ok, connected, target, config, status }
 *   PUT    /api/vault/cloud-backup        { target? } | { config? }
 *   DELETE /api/vault/cloud-backup
 *   POST   /api/vault/cloud-backup        { action: "test", target? } | { action: "run" }
 * 为什么：凭据只在服务端落盘与出场，GET 只回掩码；连接/断开/备份都是显式动作。
 */
import {
  readBackupState,
  readCloudStored,
  writeCloudStored,
} from "@/lib/storage/cloud-backup/config.server";
import {
  ensureVaultBackupScheduler,
  isVaultBackupRunning,
  runVaultBackup,
  stopVaultBackupScheduler,
} from "@/lib/storage/cloud-backup/engine.server";
import { createCloudTarget, CloudTargetError } from "@/lib/storage/cloud-backup/targets.server";
import {
  maskCloudTarget,
  parseCloudConfig,
  parseCloudTarget,
  type CloudBackupConfig,
  type CloudTargetConfig,
} from "@/lib/storage/cloud-backup/types";
import { getLogger } from "@/lib/log.server";

const log = getLogger("cloud-backup:api");

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function statusPayload(rootlessError?: string) {
  const stored = readCloudStored();
  return {
    ok: true,
    connected: Boolean(stored),
    target: stored ? maskCloudTarget(stored.target) : null,
    config: stored?.config ?? null,
    status: readBackupState(),
    unsupported: process.env.VERCEL ? "此部署形态（Serverless）不支持云备份" : rootlessError ?? null,
  };
}

async function probeTarget(target: CloudTargetConfig): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await Promise.race([
      createCloudTarget(target).probe(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("连接测试超时")), 20_000)),
    ]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof CloudTargetError || err instanceof Error ? err.message : "连接失败" };
  }
}

export async function GET() {
  ensureVaultBackupScheduler();
  return json(statusPayload());
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { target?: unknown; config?: unknown } | null;
    if (!body || (!body.target && !body.config)) return json({ ok: false, error: "缺少要保存的内容" }, 400);
    const stored = readCloudStored();

    if (body.target) {
      const target = parseCloudTarget(body.target);
      if (!target) return json({ ok: false, error: "连接信息不完整（明文 http 只允许本机地址）" }, 400);
      const probe = await probeTarget(target);
      if (!probe.ok) return json({ ok: false, error: probe.error }, 400);
      writeCloudStored({ target, config: stored?.config ?? { enabled: false, intervalHours: 24, keep: 14 } });
      ensureVaultBackupScheduler();
      log.info(`已连接云备份（${target.kind} ${maskCloudTarget(target).host}），定时备份默认关闭`);
      return json(statusPayload());
    }

    const config = parseCloudConfig(body.config);
    if (!config) return json({ ok: false, error: "配置不对（间隔 1~168 小时，保留 1~60 份）" }, 400);
    if (!stored) return json({ ok: false, error: "尚未连接云存储" }, 400);
    const next: CloudBackupConfig = { ...stored.config, ...config };
    writeCloudStored({ target: stored.target, config: next });
    return json(statusPayload());
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : "保存失败" }, 500);
  }
}

export async function DELETE() {
  try {
    writeCloudStored(null);
    stopVaultBackupScheduler();
    log.info("已断开云备份连接（云端数据未动）");
    return json(statusPayload());
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : "断开失败" }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { action?: string; target?: unknown } | null;
    if (body?.action === "test") {
      const target = (body.target ? parseCloudTarget(body.target) : readCloudStored()?.target) ?? null;
      if (!target) return json({ ok: false, error: "尚未连接云存储" }, 400);
      const probe = await probeTarget(target);
      return probe.ok ? json({ ok: true }) : json({ ok: false, error: probe.error }, 400);
    }
    if (body?.action === "run") {
      if (isVaultBackupRunning()) return json({ ok: false, error: "备份正在进行" }, 409);
      if (!readCloudStored()) return json({ ok: false, error: "尚未连接云存储" }, 400);
      // 首轮可能传很久：不等它，卡上轮询 GET 看 phase/progress
      void runVaultBackup("manual").then((res) => {
        if (!res.ok) log.warn("手动云备份失败：", res.error ?? "");
      });
      return json({ ok: true, running: true });
    }
    return json({ ok: false, error: "动作不对" }, 400);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : "操作失败" }, 500);
  }
}
