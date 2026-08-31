/**
 * 单选按钮组。
 *
 * 作用：浏览页的榜单、动态、最新/热门切换。
 * 用法：<ToggleGroup type="single" value={feed} onValueChange={...}>
 * 为什么：键盘可选中、aria-pressed 现成，不必每页自己拼胶囊按钮。
 */
import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";

export const ToggleGroup = React.forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn("flex flex-wrap items-center gap-1.5", className)}
    {...props}
  />
));
ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

export const ToggleGroupItem = React.forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(
      "inline-flex h-9 items-center justify-center rounded-full bg-elevated px-3.5 text-sm text-muted",
      "transition-[color,background-color,transform,box-shadow] duration-200 ease-out",
      "hover:text-fg active:scale-[0.96]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
      "disabled:pointer-events-none disabled:opacity-40",
      "data-[state=on]:bg-accent data-[state=on]:text-accent-fg data-[state=on]:shadow-[var(--shadow-border)]",
      className,
    )}
    {...props}
  />
));
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;
