/**
 * 队列页。
 *
 * 作用：下载和收入纸匣的唯一通道，显示类型、状态、进度。
 * 用法：侧栏「队列」。卡片和作品页的纸匣/下载都进这里。
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { RotateCcw, Trash2 } from "lucide-react";
import { ProxiedImg } from "@/components/proxied-img";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EmptySheet } from "@/components/empty-sheet";
import { runQueue } from "@/lib/queue-runner";
import { useQueue } from "@/lib/store";
import type { QueueItem } from "@/lib/types";

export const Route = createFileRoute("/queue")({ component: QueuePage });

function kindLabel(item: QueueItem) {
  return item.kind === "vault" ? "收入纸匣" : "下载";
}

function statusLabel(item: QueueItem) {
  if (item.status === "queued") return "排队";
  if (item.status === "running") return `进行中 ${item.progress}/${item.total}`;
  if (item.status === "done") return "完成";
  return item.error || "失败";
}

function QueuePage() {
  const items = useQueue((s) => s.items);
  const remove = useQueue((s) => s.remove);
  const clearDone = useQueue((s) => s.clearDone);
  const clearAll = useQueue((s) => s.clearAll);
  const patch = useQueue((s) => s.patch);

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight md:text-4xl">队列</h1>
          <p className="mt-1 text-sm text-muted">下载和收入纸匣都从这里走，按顺序处理。</p>
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
      {items.length === 0 ? (
        <EmptySheet title="队列是空的" hint="点「下载」或「收入纸匣」都会进这里，并显示进度。" />
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li
              key={item.key}
              className="kami-enter flex items-center gap-3 rounded-xl bg-surface p-3 transition-colors hover:bg-elevated"
              style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
            >
              <Link
                to="/work/$source/$id"
                params={{ source: item.source, id: item.id }}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-elevated">
                  <ProxiedImg src={item.thumb} alt="" className="size-full" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={item.title}>
                    {item.title}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {kindLabel(item)} · {item.author}
                  </p>
                  <Progress
                    value={item.total > 0 ? Math.round((item.progress / item.total) * 100) : 0}
                    className={item.status === "error" ? "mt-1.5 [&>div]:bg-danger" : "mt-1.5"}
                  />
                  <p className="mt-1 text-xs tabular-nums text-subtle">{statusLabel(item)}</p>
                </div>
              </Link>
              {item.status === "error" ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="重试"
                  onClick={() => {
                    patch(item.key, { status: "queued", error: undefined, progress: 0 });
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
