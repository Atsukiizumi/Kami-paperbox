/**
 * 浏览分页。
 *
 * 作用：一次只摊 50 张，上一页 / 下一页换批。
 * 用法：网格下面 <BrowsePager page={n} hasPrev hasNext onPage={setPage} />
 * 为什么：无限滚动从详情返回会停在最底，哨兵还可能继续要下一页。
 */
import { Button } from "@/components/ui/button";

export const BROWSE_PAGE_SIZE = 50;

export function BrowsePager({
  page,
  hasPrev,
  hasNext,
  busy,
  onPage,
}: {
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  busy?: boolean;
  onPage: (page: number) => void;
}) {
  if (!hasPrev && !hasNext) return null;
  return (
    <div className="flex items-center justify-center gap-3 pt-2">
      <Button variant="secondary" size="sm" disabled={!hasPrev || busy} onClick={() => onPage(page - 1)}>
        上一页
      </Button>
      <span className="text-xs tabular-nums text-subtle">第 {page} 页</span>
      <Button variant="secondary" size="sm" disabled={!hasNext || busy} onClick={() => onPage(page + 1)}>
        下一页
      </Button>
    </div>
  );
}
