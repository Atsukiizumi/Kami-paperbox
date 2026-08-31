/**
 * 详情页返回浏览。
 *
 * 作用：作品 / 画师 / 创作者页顶部回到浏览网格。
 * 用法：<BackToBrowse /> 放在页头最上面。
 * 为什么：侧栏「浏览」不够显眼，从作品页回来要一眼能点。
 */
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export function BackToBrowse() {
  return (
    <Link
      to="/"
      className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
    >
      <ArrowLeft className="size-4" />
      返回浏览
    </Link>
  );
}
