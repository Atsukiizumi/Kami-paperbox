/**
 * 历史浏览。
 *
 * 作用：列出最近打开过的作品，点卡片回到详情。
 * 用法：侧栏「历史」。打开作品页时自动写入。
 * 为什么：浏览器自己的后退不够看「上周点过哪张」。
 */
import { createFileRoute } from "@tanstack/react-router";
import { ArtworkGrid } from "@/components/artwork-card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { historyToCard, useViewHistory } from "@/lib/view-history";

export const Route = createFileRoute("/history")({ component: HistoryPage });

function HistoryPage() {
  const items = useViewHistory((s) => s.items);
  const clear = useViewHistory((s) => s.clear);

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight md:text-4xl">历史浏览</h1>
          <p className="mt-1 text-sm text-muted">最近打开过的作品，最多记 200 条，只存在这台浏览器。</p>
        </div>
        {items.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => clear()}>
            清空
          </Button>
        ) : null}
      </header>
      {items.length === 0 ? (
        <Alert>
          <AlertTitle>还没有历史</AlertTitle>
          <AlertDescription>打开任意作品后会记在这里。上一页仍然走浏览器记录。</AlertDescription>
        </Alert>
      ) : (
        <ArtworkGrid items={items.map(historyToCard)} empty="还没有历史。" />
      )}
    </div>
  );
}
