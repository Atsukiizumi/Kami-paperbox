import { createFileRoute, Link } from "@tanstack/react-router";
import { RotateCcw, Trash2 } from "lucide-react";
import { ProxiedImg } from "@/components/proxied-img";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { runQueue } from "@/lib/queue-runner";
import { useQueue } from "@/lib/store";

export const Route = createFileRoute("/queue")({ component: QueuePage });

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
          <h1 className="font-display text-3xl tracking-tight md:text-4xl">下载队列</h1>
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
        <Alert>
          <AlertTitle>队列是空的</AlertTitle>
          <AlertDescription>
            在作品页点「下载」，或卡片上点队列，会按顺序收入纸匣并写到文件夹。纸匣按钮只收藏、不进队列。
          </AlertDescription>
        </Alert>
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
                <p className="truncate text-sm font-medium" title={item.title}>{item.title}</p>
                <p className="truncate text-xs text-muted">{item.author}</p>
                <Progress
                  value={item.total > 0 ? Math.round((item.progress / item.total) * 100) : 0}
                  className={
                    item.status === "error" ? "mt-1.5 [&>div]:bg-danger" : "mt-1.5"
                  }
                />
                <p className="mt-1 text-xs tabular-nums text-subtle">
                  {item.status === "queued" && "等待中"}
                  {item.status === "running" && `${item.progress}/${item.total}`}
                  {item.status === "done" && "已完成"}
                  {item.status === "error" && item.error}
                </p>
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
              <Button
                variant="ghost"
                size="icon"
                aria-label="移除"
                onClick={() => remove(item.key)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
