/**
 * 标签页（Radix Tabs）。
 *
 * 作用：搜图引擎、设置里的分组切换。
 * 用法：Tabs + TabsList + TabsTrigger；value / onValueChange。
 * 为什么：键盘左右切换、选中态由组件管，不必自己拼一排 button。
 */
import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn("inline-flex h-11 w-full items-center rounded-xl bg-surface p-1", className)}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex h-9 flex-1 items-center justify-center rounded-lg px-3 text-sm text-muted",
      "transition-[color,background-color,transform,box-shadow] duration-200 ease-out",
      "hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
      "disabled:pointer-events-none disabled:opacity-40",
      "data-[state=active]:bg-accent data-[state=active]:text-accent-fg data-[state=active]:shadow-[var(--shadow-border)]",
      "active:scale-[0.96]",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("kami-enter mt-3 outline-none", className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
