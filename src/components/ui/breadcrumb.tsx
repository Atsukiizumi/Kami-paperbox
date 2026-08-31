/**
 * 面包屑。
 *
 * 作用：详情页「浏览 / 站点 / 标题」导航。
 * 用法：Breadcrumb > BreadcrumbList > Item / Separator / Page。
 * 为什么：比单独一条返回链接更能看出自己在哪一层。
 */
import type { ComponentProps, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Breadcrumb({ className, ...props }: ComponentProps<"nav">) {
  return <nav aria-label="面包屑" className={cn("text-sm", className)} {...props} />;
}

export function BreadcrumbList({ className, ...props }: ComponentProps<"ol">) {
  return (
    <ol
      className={cn("flex flex-wrap items-center gap-1 text-muted", className)}
      {...props}
    />
  );
}

export function BreadcrumbItem({ className, ...props }: ComponentProps<"li">) {
  return <li className={cn("inline-flex min-w-0 items-center gap-1", className)} {...props} />;
}

export function BreadcrumbPage({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn("truncate font-medium text-fg", className)} aria-current="page">
      {children}
    </span>
  );
}

export function BreadcrumbSeparator({ className }: { className?: string }) {
  return (
    <li aria-hidden className={cn("text-subtle", className)}>
      <ChevronRight className="size-3.5" />
    </li>
  );
}
