/**
 * 没有这一页。
 *
 * 作用：地址对不上任何路由时，别只丢一行英文 Not Found。
 * 用法：router defaultNotFoundComponent；根路由 notFoundComponent。
 * 为什么：TanStack 没配这个会警告，也确实难看。
 */
import { Link } from "@tanstack/react-router";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AppNotFound() {
  return (
    <main className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <Compass className="size-10 text-muted" strokeWidth={1.5} />
      <h1 className="font-display text-2xl text-fg">没有这一页</h1>
      <p className="max-w-sm text-sm text-muted">地址不对，或者作品已经没了。</p>
      <Button asChild>
        <Link to="/">返回浏览</Link>
      </Button>
    </main>
  );
}
