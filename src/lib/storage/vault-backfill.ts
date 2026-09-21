/**
 * 纸匣档案补全（J，09-22-product-batch-2）。
 *
 * 作用：对存量藏品逐条拉详情，回填客户端先行三字段（aiType/xRestrict/rating）
 *      与缺失标签——让 AI / R-18 筛选笺和访客遮盖对全量生效。
 * 用法：设置 → 存储「补全档案」按钮调 runVaultBackfill；生产包装在下方，单测注入桩。
 * 为什么幂等即断点：三字段全 undefined = 「未知」；补全后至少落一个显式值
 *      （pixiv/fanbox 落 aiType+xRestrict、booru 落 rating），重跑只碰仍缺的条目，
 *      中断后不需要游标。只写本地 IDB（服务端列锁不回环，备份文件携带）。
 * 为什么并发 1 + 限速：详情请求比列表重、上游风控敏感——保守换稳定。
 */
import { loadWork } from "../queue-runner.ts";
import { listVault, patchVaultMeta } from "./vault.ts";
import type { VaultMeta, WorkDetail } from "../types.ts";

export type BackfillProgress = {
  done: number;
  total: number;
  ok: number;
  failed: number;
};

export type BackfillResult = BackfillProgress & {
  /** 中途取消后仍缺的条数（= 下次重跑的工作量）。 */
  remaining: number;
};

/** 三字段全缺 = 未补全（unknown 与「确认没有」用显式 0/'' 区分）。 */
export function needsBackfill(item: VaultMeta): boolean {
  return item.aiType === undefined && item.xRestrict === undefined && item.rating === undefined;
}

/** 待补清单：只缺字段的条目（无标签计数由 UI 另行展示，不进批处理）。 */
export function backfillTargets(items: VaultMeta[]): VaultMeta[] {
  return items.filter(needsBackfill);
}

/** 详情 → 补丁：显式落值（0/'' 表示「确认没有」，与 unknown 区分）；空标签顺带补。 */
export function backfillPatch(item: VaultMeta, detail: WorkDetail): Partial<VaultMeta> {
  const patch: Partial<VaultMeta> = {
    aiType: detail.aiType || 0,
    xRestrict: detail.xRestrict || 0,
    rating: detail.rating || "",
  };
  if (item.tags.length === 0 && detail.tags.length > 0) patch.tags = detail.tags.slice(0, 80);
  return patch;
}

export type BackfillDeps = {
  loadImpl?: (source: VaultMeta["source"], id: string) => Promise<WorkDetail>;
  patchImpl?: (key: string, patch: Partial<VaultMeta>) => Promise<void>;
  listImpl?: () => Promise<VaultMeta[]>;
  /** 条间限速（默认 600ms）；单测传 0。 */
  delayMs?: number;
  /** 每完成一条回报；返回 false 视为请求取消。 */
  onProgress?: (p: BackfillProgress) => boolean | void;
};

export async function runVaultBackfill(deps: BackfillDeps = {}): Promise<BackfillResult> {
  const load = deps.loadImpl ?? loadWork;
  const patch = deps.patchImpl ?? patchVaultMeta;
  const list = deps.listImpl ?? listVault;
  const delayMs = deps.delayMs ?? 600;
  const targets = backfillTargets(await list());
  let ok = 0;
  let failed = 0;
  let cancelled = false;
  for (let i = 0; i < targets.length; i += 1) {
    const item = targets[i]!;
    const progress = { done: i, total: targets.length, ok, failed };
    const goOn = deps.onProgress?.(progress);
    if (goOn === false) {
      cancelled = true;
      break;
    }
    try {
      const detail = await load(item.source, item.id);
      await patch(item.key, backfillPatch(item, detail));
      ok += 1;
    } catch {
      failed += 1; // 单条失败跳过不连坐；完成汇报可重跑
    }
    if (delayMs > 0 && i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return {
    done: ok + failed,
    total: targets.length,
    ok,
    failed,
    remaining: cancelled ? targets.length - ok - failed : 0,
  };
}
