import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-elevated px-2 py-0.5 text-xs font-medium tracking-wide text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
