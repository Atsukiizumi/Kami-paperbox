/**
 * 表单标签。
 *
 * 作用：Cookie、代理、名称输入的可见标签。
 * 用法：<Label htmlFor="pixiv-cookie">Pixiv</Label>
 * 为什么：Radix Label 点文字会聚焦输入框。
 */
import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";

export const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn("text-xs text-muted", className)}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;
