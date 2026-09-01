/**
 * 详情页导航。
 *
 * 作用：上一页走浏览器历史；返回浏览回到首页网格。吸在顶栏下面，滚多深都能点。
 * 用法：PageFrame 在 /work /user /creator 自动放，页面里不用再插。
 * 为什么：塞进标题 header 里，header 一滚完粘性就失效。
 */
import { Link, useCanGoBack, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";

export function BackToPrevious() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  return (
    <Hint label="沿浏览记录返回，可连点多次" side="bottom">
      <span className="inline-flex">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2"
          disabled={!canGoBack}
          onClick={() => router.history.back()}
        >
          <ArrowLeft />
          上一页
        </Button>
      </span>
    </Hint>
  );
}

export function BackToBrowse() {
  return (
    <Hint label="回到浏览首页" side="bottom">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/" resetScroll={false}>
          <Compass />
          返回浏览
        </Link>
      </Button>
    </Hint>
  );
}

export function isDetailPath(pathname: string) {
  return (
    pathname.startsWith("/work/") ||
    pathname.startsWith("/user/") ||
    pathname.startsWith("/creator/")
  );
}

export function DetailNav() {
  return (
    <nav className="sticky top-14 z-20 -mx-4 flex flex-wrap items-center gap-1 border-b border-border/70 bg-bg/85 px-4 py-1.5 backdrop-blur-md md:-mx-10 md:px-10">
      <BackToPrevious />
      <BackToBrowse />
    </nav>
  );
}
