import { createFileRoute } from "@tanstack/react-router";
import { RotateCcw, Trash2 } from "lucide-react";
import { ProxiedImg } from "@/components/proxied-img";
import { Button } from "@/components/ui/button";
import { runQueue } from "@/lib/queue-runner";
import { useQueue } from "@/lib/store";
import { cn } from "@/lib/utils";

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
        <p className="py-16 text-center text-sm text-muted">
          队列是空的。在作品页点「加入队列」，会按顺序保存到纸匣并尝试下载原图。
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li
              key={item.key}
              className="kami-enter flex items-center gap-3 rounded-xl bg-surface p-3"
              style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
            >
              <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-elevated">
                <ProxiedImg src={item.thumb} alt="" className="size-full" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.title}</p>
                <p className="truncate text-xs text-muted">{item.author}</p>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-elevated">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-300",
                      item.status === "error" ? "bg-danger" : "bg-accent",
                    )}
                    style={{
                      width:
                        item.total > 0
                          ? `${Math.round((item.progress / item.total) * 100)}%`
                          : "0%",
                    }}
                  />
                </div>
                <p className="mt-1 text-xs tabular-nums text-subtle">
                  {item.status === "queued" && "等待中"}
                  {item.status === "running" && `${item.progress}/${item.total}`}
                  {item.status === "done" && "已完成"}
                  {item.status === "error" && item.error}
                </p>
              </div>
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
