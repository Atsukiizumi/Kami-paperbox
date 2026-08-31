/**
 * 标签页（Radix Tabs）。
 *
 * 作用：搜图引擎、设置里的分组切换。
 * 用法：Tabs + TabsList + TabsTrigger；value / onValueChange。
 * 为什么：滑块跟着当前项走，点一下一定看得到位移。
 */
import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";
import { pillStyle, useSlidingPill } from "./sliding-pill";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const { rootRef, pill } = useSlidingPill('[data-state="active"]');
  return (
    <TabsPrimitive.List
      ref={(node) => {
        rootRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      className={cn("relative inline-flex h-11 w-full items-center rounded-xl bg-surface p-1", className)}
      {...props}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 rounded-lg bg-accent shadow-[var(--shadow-border)] transition-[transform,width,height,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={pillStyle(pill)}
      />
      {children}
    </TabsPrimitive.List>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative z-10 inline-flex h-9 flex-1 items-center justify-center rounded-lg px-3 text-sm text-muted",
      "transition-[color,transform] duration-200 ease-out",
      "hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
      "disabled:pointer-events-none disabled:opacity-40",
      "data-[state=active]:bg-transparent data-[state=active]:text-accent-fg",
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
  <TabsPrimitive.Content ref={ref} className={cn("mt-3 outline-none", className)} {...props} />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
