/**
 * 气泡弹层（Radix Popover）。
 *
 * 作用：锚定触发元素的浮层卡片——卡片悬停预览、账号信息面板等富内容弹层。
 * 用法：Popover > PopoverTrigger asChild + PopoverContent（可带 PopoverArrow）。
 * 为什么：Tooltip 只放短文案、DropdownMenu 只放动作项；介于两者之间的富内容
 *       用 Popover；进场与弹层家族同一条「纸片落下」动效（纸感基座 PR1）。
 */
import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, sideOffset = 8, align = "start", ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      align={align}
      className={cn(
        "kami-drop-in z-50 w-72 rounded-xl border border-border bg-surface p-4 text-fg shadow-[var(--shadow-paper-2)] data-[state=closed]:kami-veil-out",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export const PopoverArrow = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Arrow>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Arrow>
>(({ className, ...props }, ref) => (
  <PopoverPrimitive.Arrow
    ref={ref}
    className={cn("fill-surface drop-shadow-[0_-2px_4px_rgb(0_0_0_/_0.2)]", className)}
    width={12}
    height={6}
    {...props}
  />
));
PopoverArrow.displayName = PopoverPrimitive.Arrow.displayName;
