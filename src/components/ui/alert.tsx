/**
 * 提示条。
 *
 * 作用：错误、订阅限制、空状态说明。
 * 用法：<Alert variant="danger"><AlertTitle/><AlertDescription/></Alert>
 * 为什么：用 Radix 语义的 role=alert，避免每页手写一块红框。
 */
import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva("rounded-xl border px-4 py-4 text-sm", {
  variants: {
    variant: {
      default: "border-border bg-surface text-muted",
      danger: "border-danger/30 bg-danger/10 text-danger",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Alert({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("font-medium text-fg", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1 leading-relaxed", className)} {...props} />;
}
