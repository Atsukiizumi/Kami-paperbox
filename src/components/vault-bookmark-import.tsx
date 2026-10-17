"use client";

/**
 * 收藏夹导入向导（B1-B5，10-17-bookmark-import-polish）。
 *
 * 作用：纸匣页内联分区（照 VaultCleanWizard 先例）——拉取 Pixiv 我的收藏
 *      （/api/source op=pixivMyBookmarks，63 页硬顶）→ 预览四行计数
 *      （filterBatchable：总数/已在纸匣/已在队列/可入队）→ 仅新增或全部
 *      enqueueWorks(kind=vault|download)，toast 接 formatBatchEnqueueToast。
 * 用法：<VaultBookmarkImport inVaultKeys={vaultKeys} onChanged={refresh 链} onClose={...} />
 *      挂 vault.tsx 清理向导同位；B5 未登录在 vault.tsx 按钮层 disabled，本组件兜 toast。
 * 为什么循环不经队列直打 /api/source：queue-throttle 的 429 降档只作用于队列 worker
 *      （noteRateLimit 在 processOne 的 catch、降档只改 pumpWave 处理位），管不到这里——
 *      向导 catch 到（429）文案时手动 noteRateLimit() 桥接，让下载队列同步进 90s 冷却。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { filterBatchable } from "@/lib/batch-collect";
import { formatBatchEnqueueToast } from "@/lib/queue-cap";
import { enqueueWorks } from "@/lib/queue-runner";
import { noteRateLimit, rateLimitError } from "@/lib/queue-throttle";
import { fetchSource } from "@/lib/source";
import { cookiesFromSettings, useQueue, useSettings } from "@/lib/store";
import { isPixivLoggedInSession } from "@/lib/sync/browser-login";
import type { WorkCard } from "@/lib/types";
import { sleep } from "@/lib/utils";

/** 页间限速：队列 worker 波间隔 400ms（queue-runner）是已知不触发风控的节奏，纯列表请求取 2.5 倍保守值。 */
const BOOKMARK_PAGE_PACE_MS = 1000;
/** 单批硬顶：63 页 × 48 ≈ 3000 张（PRD 上限；zod max(63) 与 source-cache key 同口径）。 */
const BOOKMARK_MAX_PAGES = 63;

type Phase =
  | { kind: "idle" }
  | { kind: "fetching"; got: number; page: number }
  | { kind: "preview" }
  | { kind: "done"; kept: number; dropped: number }
  | { kind: "error"; message: string };

export function VaultBookmarkImport({
  inVaultKeys,
  onChanged,
  onClose,
}: {
  /** 当前纸匣 key 集（vault.tsx 的 vaultKeys memo）：预览计数与「仅新增」口径用。 */
  inVaultKeys: Set<string>;
  /** 入队完成后通知父级 refresh 链，随后 onClose。 */
  onChanged: () => void | Promise<void>;
  onClose: () => void;
}) {
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [cards, setCards] = useState<WorkCard[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [lastCompletedPage, setLastCompletedPage] = useState(0);
  const [capped, setCapped] = useState(false);
  const [scope, setScope] = useState<"new" | "all">("new");
  // 中止只在页边界生效：fetch 进行中点「停止」，本页完成后仍进 preview（已拉部分保留）
  const stop = useRef(false);

  useEffect(() => {
    return () => {
      stop.current = true;
    };
  }, []);

  async function fetchAll(startPage: number) {
    if (!isPixivLoggedInSession(pixivCookie)) {
      toast.error("先在设置里登录 Pixiv");
      return;
    }
    if (startPage === 1) {
      setCards([]);
      setTotal(null);
      setLastCompletedPage(0);
      setCapped(false);
    }
    stop.current = false;
    const collected = startPage === 1 ? [] : [...cards];
    const seen = new Set(collected.map((c) => c.id));
    setPhase({ kind: "fetching", got: collected.length, page: startPage });
    try {
      for (let page = startPage; page <= BOOKMARK_MAX_PAGES; page += 1) {
        if (stop.current) break;
        const r = await fetchSource({
          data: { op: "pixivMyBookmarks", page, ...cookiesFromSettings("pixiv") },
        });
        if (r.op !== "pixivMyBookmarks") break;
        setTotal((t) => t ?? r.total);
        for (const card of r.items) {
          // 上游翻页漂移（收藏夹头部增删）时同 id 去重，重复条目不进预览
          if (seen.has(card.id)) continue;
          seen.add(card.id);
          collected.push(card);
        }
        setCards([...collected]);
        setLastCompletedPage(page);
        setPhase({ kind: "fetching", got: collected.length, page });
        if (!r.nextPage) break;
        if (page === BOOKMARK_MAX_PAGES) {
          setCapped(true);
          break;
        }
        await sleep(BOOKMARK_PAGE_PACE_MS);
      }
      setPhase({ kind: "preview" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "收藏夹加载失败";
      // 429 桥接：向导循环在 queue-throttle 管辖外，手动让下载队列同步进 90s 冷却
      if (rateLimitError(message)) noteRateLimit();
      setPhase({ kind: "error", message });
    }
  }

  // 预览时快照一次 live 队列 key（queued/running 算占位；done/error 不算）——
  // 入队后向导即关闭，不需要随队列变化重算
  const queueKeys = useMemo(() => {
    if (phase.kind !== "preview") return new Set<string>();
    const keys = new Set<string>();
    for (const item of useQueue.getState().items) {
      if (item.status === "queued" || item.status === "running") keys.add(item.key);
    }
    return keys;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在进入 preview 这一拍取快照
  }, [phase]);

  const tally = useMemo(
    () => filterBatchable(cards, { inVaultKeys, inQueueKeys: queueKeys }),
    [cards, inVaultKeys, queueKeys],
  );

  function enqueue(kind: "vault" | "download") {
    // 仅新增 = filterBatchable 结果；全部 = cards 原表（enqueueWorks 对已在队列 key 自去重）
    const list = scope === "new" ? tally.batchable : cards;
    if (list.length === 0) return;
    const enqueued = enqueueWorks(list, kind);
    const skipped: string[] = [];
    if (scope === "new" && tally.skippedVault > 0) skipped.push(`已在纸匣 ${tally.skippedVault}`);
    if (scope === "new" && tally.skippedQueue > 0) skipped.push(`队列中 ${tally.skippedQueue}`);
    toast.success(formatBatchEnqueueToast(kind, enqueued, skipped));
    setPhase({ kind: "done", kept: enqueued.kept, dropped: enqueued.dropped });
    void (async () => {
      try {
        await onChanged();
      } finally {
        onClose();
      }
    })();
  }

  return (
    <section className="space-y-4 rounded-lg border border-fg/10 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium">导入收藏夹</h2>
        <span className="text-xs text-subtle">把 Pixiv 收藏分批拉进来建档；单批最多 63 页（约 3000 张），页间限速防风控。</span>
      </div>

      {phase.kind === "idle" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted">从你的 Pixiv 收藏（公开）拉取作品列表，选好后收入纸匣或下载。</p>
          <Button size="sm" className="ml-auto" onClick={() => void fetchAll(1)}>
            开始拉取
          </Button>
        </div>
      ) : null}

      {phase.kind === "fetching" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted tabular-nums">
            正在拉取第 {phase.page} 页…已拉 {phase.got}
            {total ? ` / ${total}` : ""} 张
          </p>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { stop.current = true; }}>
            停止
          </Button>
        </div>
      ) : null}

      {phase.kind === "error" ? (
        <div className="space-y-2">
          <p className="text-sm text-fg">拉取失败：{phase.message}</p>
          <p className="text-xs text-muted">已拉的 {cards.length} 张还在，不丢数据；同口径 30 分钟内重拉走缓存、不打上游。</p>
          <Button size="sm" onClick={() => void fetchAll(lastCompletedPage + 1)}>
            从第 {lastCompletedPage + 1} 页继续
          </Button>
        </div>
      ) : null}

      {phase.kind === "preview" ? (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">收藏夹总数</dt>
              <dd className="tabular-nums">{total ?? cards.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">已在纸匣</dt>
              <dd className="tabular-nums">{tally.skippedVault}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">已在队列</dt>
              <dd className="tabular-nums">{tally.skippedQueue}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">可入队</dt>
              <dd className="tabular-nums">{tally.batchable.length}</dd>
            </div>
          </dl>
          {capped ? (
            <p className="text-xs text-subtle">收藏超过 3000 张，本批到此为止——稍后可再导入下一批。</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="vault-import-scope"
                checked={scope === "new"}
                onChange={() => setScope("new")}
              />
              仅新增
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="vault-import-scope"
                checked={scope === "all"}
                onChange={() => setScope("all")}
              />
              全部
            </label>
            <Button
              size="sm"
              className="ml-auto"
              disabled={(scope === "new" ? tally.batchable.length : cards.length) === 0}
              onClick={() => enqueue("vault")}
            >
              全部入队（收入纸匣）
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={(scope === "new" ? tally.batchable.length : cards.length) === 0}
              onClick={() => enqueue("download")}
            >
              仅下载
            </Button>
          </div>
        </div>
      ) : null}

      {phase.kind === "done" ? (
        <p className="text-sm text-muted tabular-nums">
          已入队 {phase.kept} 张{phase.dropped > 0 ? `，${phase.dropped} 张没排进队列` : ""}。
        </p>
      ) : null}
    </section>
  );
}
