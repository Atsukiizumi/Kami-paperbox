"use client";

/**
 * 纸匣清理向导（K，10-17-slideshow-stale-clean）。
 *
 * 作用：纸匣页内联分区（照 VaultDedup 先例，不做 Dialog 两步）——维度区
 *      （超过 3/6/12 个月未读｜已被替换｜缺标记 三个 chip + 按体积排序开关）与
 *      预览确认区（命中行 + 全选/清空 + 已选 N 张·合计 + 移入纸篓）一屏上下。
 *      移入走既有逐条软删链（deleteVaultWork + forgetVaultKey），busy 防双击
 *      并实时报进度，失败条目留列表可重试；命中超 200 只列前 200（截断在排序后）。
 * 用法：<VaultCleanWizard items={all} history={historyItems} onChanged={...} />
 *      挂 vault.tsx VaultDedup 同位；onChanged = refresh() + refreshTrash()。
 * 为什么无历史文案是「没打开过（或久到查不到）」：未读口径取激进侧（窗外历史当
 *      未打开），其中有些其实打开过只是早于 90 天窗——文案不谎称从没打开过。
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useVaultCover } from "@/components/vault-cover";
import { useBatchSelection } from "@/components/use-batch-selection";
import {
  CLEAN_BATCH_LIMIT,
  cleanupCandidates,
  type CleanCandidate,
} from "@/lib/storage/vault-profile";
import type { HistoryEntry } from "@/lib/view-history";
import { deleteVaultWork } from "@/lib/storage/vault";
import { forgetVaultKey } from "@/lib/storage/vault-index";
import type { VaultMeta } from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";

/** 窗内最后查看的相对时间（预览行展示用，天数算术与 CLEAN_MONTH_MS 同基）。 */
function relativeViewedAt(at: number, now = Date.now()): string {
  const days = Math.floor(Math.max(0, now - at) / 86_400_000);
  if (days < 1) return "今天";
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}

/** 预览命中行：小图（useVaultCover 同一条封面链）｜元数据｜最后查看｜未动月数｜勾选。 */
function CleanRow({
  candidate,
  checked,
  onToggle,
}: {
  candidate: CleanCandidate;
  checked: boolean;
  onToggle: () => void;
}) {
  const { thumb } = useVaultCover(candidate.item);
  const { item } = candidate;
  return (
    <label className="flex items-center gap-3 rounded-lg bg-elevated/50 p-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={`选中：${item.title}`}
        className="size-4 shrink-0 accent-[var(--color-accent)]"
      />
      {thumb ? (
        <img src={thumb} alt="" className="size-24 shrink-0 rounded-md object-cover" loading="lazy" />
      ) : (
        <span className="grid size-24 shrink-0 place-items-center rounded-md bg-fg/5 text-xs text-subtle">无预览</span>
      )}
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block truncate text-sm font-medium">{item.title}</span>
        <span className="block truncate text-xs text-muted">
          {item.source} · {item.author || "未知作者"} · {formatBytes(item.bytes)}
        </span>
        <span className="block truncate text-xs text-subtle">
          最后查看：{candidate.lastViewedAt ? relativeViewedAt(candidate.lastViewedAt) : "没打开过（或久到查不到）"} ·{" "}
          {candidate.idleMonths > 0 ? `${candidate.idleMonths} 月未动` : "常在看"}
        </span>
      </span>
    </label>
  );
}

function FilterChip({
  label,
  checked,
  disabled,
  onToggle,
  children,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm",
        checked ? "border-accent text-fg" : "border-fg/15 text-muted",
        disabled && "opacity-50",
      )}
    >
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} />
      {label}
      {children}
    </label>
  );
}

export function VaultCleanWizard({
  items,
  history,
  onChanged,
}: {
  /** 纸匣全量 meta（vault.tsx 的 all）。 */
  items: VaultMeta[];
  /** 90 天浏览历史（窗内才条目）。 */
  history: HistoryEntry[];
  /** 移入纸篓完成后通知父级：refresh() 回填纸匣 + refreshTrash() 回填纸篓计数。 */
  onChanged: () => void | Promise<void>;
}) {
  const [unreadOn, setUnreadOn] = useState(false);
  const [unreadMonths, setUnreadMonths] = useState<3 | 6 | 12>(3);
  const [replacedOn, setReplacedOn] = useState(false);
  const [missingFlagsOn, setMissingFlagsOn] = useState(false);
  const [sortByBytes, setSortByBytes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  // 向导自管一份选择实例：勾选语义同纸匣批量（key = VaultMeta.key）
  const sel = useBatchSelection();

  const candidates = useMemo(
    () =>
      cleanupCandidates(items, history, {
        unreadMonths: unreadOn ? unreadMonths : undefined,
        replaced: replacedOn,
        missingFlags: missingFlagsOn,
        sortByBytes,
      }),
    [items, history, unreadOn, unreadMonths, replacedOn, missingFlagsOn, sortByBytes],
  );
  // 纯函数返回全量；截断在排序之后（保「大文件优先」），勾选/合计只算截断后可见集合
  const visible = useMemo(() => candidates.slice(0, CLEAN_BATCH_LIMIT), [candidates]);
  const visibleKeys = useMemo(() => visible.map((c) => c.item.key), [visible]);
  const overLimit = candidates.length > CLEAN_BATCH_LIMIT;

  // K-3 默认全选命中项：只依赖候选 key 列表——用户逐个取消不被覆盖，候选变才整集重置
  useEffect(() => {
    sel.selectAll(visibleKeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectAll 身份每渲染都变，依赖它会每渲染整集重置
  }, [visibleKeys]);

  const selectedRows = visible.filter((c) => sel.selected.has(c.item.key));
  const selectedBytes = selectedRows.reduce((n, c) => n + c.item.bytes, 0);

  async function trashSelected() {
    const keys = visible.filter((c) => sel.selected.has(c.item.key)).map((c) => c.item.key);
    if (keys.length === 0 || busy) return;
    if (!window.confirm(`把选中的 ${keys.length} 张移入纸篓？纸篓里可以放回去。`)) return;
    setBusy(true);
    setProgress({ done: 0, total: keys.length });
    let done = 0;
    let failed = 0;
    try {
      // 逐条走既有软删链，不抽批量 API（服务端无批量端点；串行不冻结 UI，busy 报进度防第二击）
      for (const key of keys) {
        const ok = await deleteVaultWork(key);
        if (ok) {
          forgetVaultKey(key);
          done += 1;
        } else {
          failed += 1; // 失败不回滚（纸篓可还原），刷新后仍在命中列表里可重试
        }
        setProgress({ done: done + failed, total: keys.length });
      }
      await onChanged();
      if (failed > 0) {
        toast.error(`移入纸篓 ${done} 张，${failed} 张失败（网络？），失败的还在列表里`);
      } else {
        toast.success(`已把 ${done} 张放进纸篓（可在纸篓里放回去）`);
      }
    } finally {
      setBusy(false);
    }
  }

  const anyFilter = unreadOn || replacedOn || missingFlagsOn;

  return (
    <section className="space-y-4 rounded-lg border border-fg/10 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium">清理向导</h2>
        <span className="text-xs text-subtle">勾维度 → 预览命中 → 移入纸篓（纸篓里可以放回去）。</span>
      </div>

      {/* 维度区：执行期整体 disable——过滤条件在执行中变会让「正在删的列表」与「屏幕上的列表」错位 */}
      <div className="flex flex-wrap items-center gap-2" aria-label="清理维度">
        <FilterChip label="超过" checked={unreadOn} disabled={busy} onToggle={setUnreadOn}>
          <select
            value={unreadMonths}
            disabled={busy || !unreadOn}
            onChange={(e) => setUnreadMonths(Number(e.target.value) as 3 | 6 | 12)}
            aria-label="未读月数"
            className="bg-transparent text-sm outline-none"
          >
            <option value={3}>3</option>
            <option value={6}>6</option>
            <option value={12}>12</option>
          </select>
          个月未读
        </FilterChip>
        <FilterChip label="已被替换" checked={replacedOn} disabled={busy} onToggle={setReplacedOn} />
        <FilterChip label="缺标记" checked={missingFlagsOn} disabled={busy} onToggle={setMissingFlagsOn} />
        <FilterChip label="按体积排序" checked={sortByBytes} disabled={busy} onToggle={setSortByBytes} />
      </div>

      {!anyFilter ? (
        <p className="text-sm text-muted">先勾一个维度。</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted">没有命中这个维度的藏品。</p>
      ) : (
        <>
          <div className="space-y-2">
            {visible.map((c) => (
              <CleanRow
                key={c.item.key}
                candidate={c}
                checked={sel.selected.has(c.item.key)}
                onToggle={() => sel.toggle(c.item.key)}
              />
            ))}
          </div>
          {overLimit ? (
            <p className="text-xs text-subtle">
              命中 {candidates.length} 条，本批只列前 {CLEAN_BATCH_LIMIT} 条（按当前排序），清完这批再开下一批。
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => sel.selectAll(visibleKeys)}>
              全选
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={sel.clear}>
              清空
            </Button>
            <span className="text-xs tabular-nums text-muted">
              已选 {selectedRows.length} 张 · 合计 {formatBytes(selectedBytes)}
            </span>
            <Button
              size="sm"
              className="ml-auto"
              disabled={busy || selectedRows.length === 0}
              onClick={() => void trashSelected()}
            >
              {busy ? `移入中 ${progress.done}/${progress.total}…` : `移入纸篓（${selectedRows.length}）`}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
