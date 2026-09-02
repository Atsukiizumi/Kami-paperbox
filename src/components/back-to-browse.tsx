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

export function BackToPrevious() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  return (
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
  );
}

export function BackToBrowse() {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link to="/" resetScroll={false}>
        <Compass />
        返回浏览
      </Link>
    </Button>
  );
}

export function isWorkPath(pathname: string) {
  return pathname.startsWith("/work/");
}

export function isDetailPath(pathname: string) {
  return (
    pathname.startsWith("/work/") ||
    pathname.startsWith("/user/") ||
    pathname.startsWith("/creator/") ||
    pathname.startsWith("/pool/")
  );
}

export function isMainNavPath(pathname: string) {
  return (
    pathname === "/queue" ||
    pathname === "/vault" ||
    pathname === "/settings" ||
    pathname === "/search" ||
    pathname === "/history" ||
    pathname.startsWith("/queue/") ||
    pathname.startsWith("/vault/") ||
    pathname.startsWith("/settings/") ||
    pathname.startsWith("/search/") ||
    pathname.startsWith("/history/")
  );
}

export function DetailNav() {
  return (
    <nav className="kami-detail-nav sticky top-14 z-20 -mx-4 flex flex-wrap items-center gap-1 border-b border-border/70 bg-bg/85 px-4 backdrop-blur-md md:-mx-10 md:px-10">
      <BackToPrevious />
      <BackToBrowse />
    </nav>
  );
}
