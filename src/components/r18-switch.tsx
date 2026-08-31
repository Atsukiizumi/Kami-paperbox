import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";

export function R18Switch({ className }: { className?: string }) {
  const safeMode = useSettings((s) => s.safeMode);
  const setSafeMode = useSettings((s) => s.setSafeMode);
  return (
    <label className={cn("flex items-center gap-2 text-sm text-muted", className)}>
      <span className={cn("font-medium", !safeMode && "text-fg")}>R-18</span>
      <Switch
        checked={!safeMode}
        onCheckedChange={(on) => setSafeMode(!on)}
        aria-label="R-18 内容"
      />
    </label>
  );
}
