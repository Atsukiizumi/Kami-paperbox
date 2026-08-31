import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    className={cn(
      "peer inline-flex h-7 w-11 shrink-0 cursor-pointer items-center rounded-full border border-border bg-elevated transition-colors",
      "data-[state=checked]:bg-accent data-[state=checked]:border-accent",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
      "disabled:cursor-not-allowed disabled:opacity-40",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block size-5 rounded-full bg-fg shadow-sm transition-transform",
        "data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-0.5",
        "data-[state=checked]:bg-accent-fg",
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
