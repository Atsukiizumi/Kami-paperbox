/**
 * 详情页导航。
 *
 * 作用：上一页走浏览器历史；返回浏览回到首页网格。
 * 用法：<DetailNav /> 放作品 / 画师 / 创作者页顶部。
 * 为什么：history 是一叠记录，browse → 作品 → 画师 → 另一张作品，上一页可连点。
 *        返回浏览固定去 `/`，不依赖从哪进来。没有站内历史时上一页不可用。
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

export function DetailNav() {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <BackToPrevious />
      <BackToBrowse />
    </div>
  );
}
