/**
 * 单选按钮组。
 *
 * 作用：浏览页的榜单、动态、最新/热门切换。
 * 用法：<ToggleGroup type="single" value={feed} onValueChange={...}>
 * 为什么：底下有一块滑块跟着走，换榜时一定看得到位移。
 */
import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";
import { pillStyle, useSlidingPill } from "./sliding-pill";

export const ToggleGroup = React.forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, children, ...props }, ref) => {
  const { rootRef, pill } = useSlidingPill('[data-state="on"]');
  return (
    <ToggleGroupPrimitive.Root
      ref={(node) => {
        rootRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      className={cn("relative flex flex-wrap items-center gap-1.5", className)}
      {...props}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 rounded-full bg-accent transition-[transform,width,height,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={pillStyle(pill)}
      />
      {children}
    </ToggleGroupPrimitive.Root>
  );
});
ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

export const ToggleGroupItem = React.forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(
      "relative z-10 inline-flex h-9 items-center justify-center rounded-full bg-elevated px-3.5 text-sm text-muted",
      "transition-[color,background-color,transform] duration-200 ease-out",
      "hover:text-fg active:scale-[0.96]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
      "disabled:pointer-events-none disabled:opacity-40",
      "data-[state=on]:bg-transparent data-[state=on]:text-accent-fg",
      className,
    )}
    {...props}
  />
));
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;
