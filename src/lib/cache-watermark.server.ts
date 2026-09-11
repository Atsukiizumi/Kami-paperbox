/**
 * 缓存目录水位治理（TD-07 / PER-1 / R-08）。
 *
 * 作用：`.data/media` 与 `.data/source` 只增不减（惰性删除只在再次读到时
 *      发生），长跑实例磁盘无界。这里在写入路径上惰性触发：每 N 次写
 *      异步扫一遍目录，超水位就按 mtime 从最旧开始删，删到 80% 为止。
 * 用法：writeCachedMedia / writeSourceCache 各自计数调用 noteCacheWrite(kind)。
 * 为什么不用启动钩子：Next 的 instrumentation bundle 处理不了 node:fs
 *      一类依赖（第一批已踩过）；写入时触发天然自限速，也不用定时器。
 * 水位：kami.config.json 的 `cache: { mediaMaxMb, sourceMaxMb }`，缺省
 *      media 2GB / source 512MB（13 号文档：先按保守默认，观察增速再调）。
 */
import { readdirSync, statSync, unlinkSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveKamiRoot } from "./proxy.server.ts";

export type CacheKind = "media" | "source";

const SWEEP_EVERY_N_WRITES = 50;
const KEEP_RATIO = 0.8;

export const DEFAULT_WATERMARK_MB: Record<CacheKind, number> = {
  media: 2048,
  source: 512,
};

const writeCounts: Record<CacheKind, number> = { media: 0, source: 0 };
const sweeping = new Set<CacheKind>();

/** kami.config.json 的 cache 段（缺省回退默认值；读不到按缺省）。 */
export function watermarkConfig(root = resolveKamiRoot()): Record<CacheKind, number> {
  try {
    const raw = JSON.parse(readFileSync(join(root, "kami.config.json"), "utf8")) as {
      cache?: { mediaMaxMb?: unknown; sourceMaxMb?: unknown };
    };
    const num = (v: unknown, fallback: number) =>
      typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
    return {
      media: num(raw.cache?.mediaMaxMb, DEFAULT_WATERMARK_MB.media),
      source: num(raw.cache?.sourceMaxMb, DEFAULT_WATERMARK_MB.source),
    };
  } catch (err) {
    console.warn("[cache-watermark:load-config] 配置不可读，用水位默认值：", err instanceof Error ? err.message : err);
    return { ...DEFAULT_WATERMARK_MB };
  }
}

/** 写入路径的惰性触发点：每 N 次写异步扫一遍，绝不阻塞写入本身。 */
export function noteCacheWrite(kind: CacheKind, root = resolveKamiRoot()): void {
  writeCounts[kind] += 1;
  if (writeCounts[kind] % SWEEP_EVERY_N_WRITES !== 0) return;
  if (sweeping.has(kind)) return;
  sweeping.add(kind);
  void sweepCache(kind, root)
    .catch((err) => console.warn("[cache-watermark:sweep] 清理失败（下个周期再试）：", err instanceof Error ? err.message : err))
    .finally(() => sweeping.delete(kind));
}

/**
 * 扫目录 + 按水位淘汰。直接导出给测试用；运行时走 noteCacheWrite 的
 * 惰性触发。返回删除的文件数（无超限 / 扫描失败为 0）。
 */
export async function sweepCache(kind: CacheKind, root = resolveKamiRoot()): Promise<number> {
  const dir = join(root, ".data", kind);
  const capBytes = watermarkConfig(root)[kind] * 1024 * 1024;
  const entries = scanEntries(dir);
  if (entries.length === 0) return 0;
  let total = 0;
  for (const e of entries) total += e.bytes;
  if (total <= capBytes) return 0;

  const target = Math.floor(capBytes * KEEP_RATIO);
  // 最旧先走；mtime 相同按名字稳定排序。
  entries.sort((a, b) => a.mtime - b.mtime || (a.name < b.name ? -1 : 1));
  let removed = 0;
  for (const e of entries) {
    if (total <= target) break;
    try {
      unlinkSync(join(dir, e.name));
      total -= e.bytes;
      removed += 1;
    } catch {
      /* 单个删不掉就跳过，下一轮再来 */
    }
  }
  return removed;
}

function scanEntries(dir: string): { name: string; bytes: number; mtime: number }[] {
  try {
    const out = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".bin") && !name.endsWith(".json")) continue;
      try {
        const st = statSync(join(dir, name));
        if (!st.isFile()) continue;
        out.push({ name, bytes: st.size, mtime: st.mtimeMs });
      } catch {
        /* 竞态消失的文件跳过 */
      }
    }
    return out;
  } catch {
    return [];
  }
}
