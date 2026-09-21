import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/lib/store";
import type { Source } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 当前站点的 R-18 快捷开关：读写设置里该站点自己的安全模式，与设置页实时同步。 */
export function R18Switch({ source, className }: { source: Source; className?: string }) {
  const safeMode = useSettings((s) => s.safeModeBySite[source]);
  const setSafeModeFor = useSettings((s) => s.setSafeModeFor);
  return (
    <label className={cn("flex items-center gap-2 text-sm text-muted", className)}>
      <span className={cn("font-medium", !safeMode && "text-fg")}>R-18</span>
      <Switch
        checked={!safeMode}
        onCheckedChange={(on) => setSafeModeFor(source, !on)}
        aria-label="R-18 内容"
      />
    </label>
  );
}
