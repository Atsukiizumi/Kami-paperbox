/**
 * 详情页返回浏览。
 *
 * 作用：作品 / 画师 / 创作者页顶部回到浏览网格。
 * 用法：<BackToBrowse /> 放在页头最上面。
 * 为什么：resetScroll=false，沿用刚才的滚动位置和列表缓存，不要整页从头拉。
 */
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BackToBrowse() {
  return (
    <Button variant="ghost" size="sm" asChild className="-ml-2">
      <Link to="/" resetScroll={false}>
        <ArrowLeft />
        返回浏览
      </Link>
    </Button>
  );
}
