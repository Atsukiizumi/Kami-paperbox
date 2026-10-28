/**
 * 队列页。
 *
 * 作用：下载和收入纸匣的唯一通道，显示类型、状态、进度。
 * 用法：侧栏「队列」。卡片和作品页的纸匣/下载都进这里。
 */
"use client";

import { Link } from "@/lib/kami-link";
import { RotateCcw, Trash2 } from "lucide-react";
import { ProxiedImg } from "@/components/proxied-img";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EmptySheet } from "@/components/empty-sheet";
import { runQueue } from "@/lib/queue-runner";
import { classifyQueueError, QUEUE_ERROR_KIND_LABEL, retryableKeys, type QueueErrorKind } from "@/lib/queue-retry";
import { useQueue } from "@/lib/store";
import type { QueueItem } from "@/lib/types";

function kindLabel(item: QueueItem) {
  return item.kind === "vault" ? "收入纸匣" : "下载";
}

function statusLabel(item: QueueItem) {
  if (item.status === "queued") {
    if (item.attempts && item.error) return `排队 · 失败 ${item.attempts} 次后自动重试`;
    return "排队";
  }
  if (item.status === "running") return `进行中 ${item.progress}/${item.total}`;
  if (item.status === "done") return "完成";
  return item.error || "失败";
}

export function QueuePage() {
  const items = useQueue((s) => s.items);
  const remove = useQueue((s) => s.remove);
  const clearDone = useQueue((s) => s.clearDone);
  const clearAll = useQueue((s) => s.clearAll);
  const patch = useQueue((s) => s.patch);

  // X2：失败分类汇总 + 一键重试全部失败（用户态判死项不回炉）
  const failed = items.filter((x) => x.status === "error");
  const failedKinds = failed.reduce<Map<QueueErrorKind, number>>((map, x) => {
    const kind = classifyQueueError(x.error ?? "");
    map.set(kind, (map.get(kind) ?? 0) + 1);
    return map;
  }, new Map());
  const retryKeys = retryableKeys(items);
  const deadCount = failed.length - retryKeys.length;

  function retryAllFailed() {
    for (const key of retryKeys) {
      patch(key, { status: "queued", error: undefined, progress: 0, attempts: 0, nextRetryAt: undefined });
    }
    void runQueue();
  }

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="kami-node-title text-3xl md:text-4xl">队列</h1>
          <p className="kami-node-note">下载和收入纸匣都从这里走，按顺序处理。</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => clearDone()}>
            清除已完成
          </Button>
          <Button variant="danger" size="sm" onClick={() => clearAll()}>
            清空
          </Button>
        </div>
      </header>
      {failed.length > 0 ? (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-border pb-3">
          <span className="kami-dk-label">失败 {failed.length} 项</span>
          {[...failedKinds.entries()].map(([kind, n]) => (
            <span key={kind} className="text-xs text-muted">
              {QUEUE_ERROR_KIND_LABEL[kind]} ×{n}
            </span>
          ))}
          {retryKeys.length > 0 ? (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={retryAllFailed}>
              <RotateCcw className="size-4" />
              重试全部失败（{retryKeys.length}）
            </Button>
          ) : null}
          {deadCount > 0 ? (
            <span className="text-xs text-subtle">{deadCount} 项不可自动重试（需登录 / 内容不可用）</span>
          ) : null}
        </div>
      ) : null}
      {items.length === 0 ? (
        <EmptySheet title="队列是空的" hint="点「下载」或「收入纸匣」都会进这里，并显示进度。" />
      ) : (
        <ul className="border-b border-border">
          {items.map((item, i) => (
            <li
              key={item.key}
              className="kami-enter kami-queue-row flex items-center gap-3 py-3"
              style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
            >
              <Link
                to="/work/$source/$id"
                params={{ source: item.source, id: item.id }}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                <div className="kami-dk-tile size-14 shrink-0 overflow-hidden bg-elevated">
                  <ProxiedImg src={item.thumb} alt="" className="size-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm" title={item.title}>
                    {item.title}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    <span className={item.kind === "vault" ? "font-display text-danger" : undefined}>{kindLabel(item)}</span>
                    {item.author ? ` · ${item.author}` : ""}
                  </p>
                  <p
                    className={
                      item.status === "done"
                        ? "kami-done-pop mt-0.5 text-xs tabular-nums text-subtle"
                        : item.status === "error"
                          ? "mt-0.5 text-xs text-danger"
                          : "mt-0.5 text-xs tabular-nums text-muted"
                    }
                  >
                    {statusLabel(item)}
                  </p>
                  <Progress
                    value={item.total > 0 ? Math.round((item.progress / item.total) * 100) : 0}
                    className={
                      item.status === "error"
                        ? "mt-1.5 h-px rounded-none bg-border [&>div]:rounded-none [&>div]:bg-danger"
                        : "mt-1.5 h-px rounded-none bg-border [&>div]:rounded-none [&>div]:bg-fg"
                    }
                  />
                </div>
              </Link>
              {item.status === "error" ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="重试"
                  onClick={() => {
                    patch(item.key, { status: "queued", error: undefined, progress: 0, attempts: 0, nextRetryAt: undefined });
                    void runQueue();
                  }}
                >
                  <RotateCcw className="size-4" />
                </Button>
              ) : null}
              <Button variant="ghost" size="icon" aria-label="移除" onClick={() => remove(item.key)}>
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
