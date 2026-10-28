/**
 * 单选按钮组。
 *
 * 作用：浏览页的榜单、动态、最新/热门切换。
 * 用法：<ToggleGroup type="single" value={feed} onValueChange={...}>
 * 为什么：当前项用衬线斜体和一条发丝线，换榜时看得到字，不靠底色药丸。
 */
import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";

export const ToggleGroup = React.forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, children, ...props }, ref) => {
  return (
    <ToggleGroupPrimitive.Root
      ref={ref}
      className={cn("relative flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border pb-1", className)}
      {...props}
    >
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
      "relative z-10 inline-flex h-9 items-center justify-center bg-transparent px-0 text-sm text-muted",
      "transition-colors duration-200 ease-out",
      "hover:text-fg",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
      "disabled:pointer-events-none disabled:opacity-40",
      "data-[state=on]:bg-transparent data-[state=on]:font-display data-[state=on]:text-fg data-[state=on]:italic data-[state=on]:shadow-[inset_0_-1px_0_var(--color-danger)]",
      className,
    )}
    {...props}
  />
));
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;
