import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";

export function AiFilterSwitch({ className }: { className?: string }) {
  const hideAi = useSettings((s) => s.hideAi);
  const setHideAi = useSettings((s) => s.setHideAi);
  return (
    <label className={cn("flex items-center gap-2 text-sm text-muted", className)}>
      <span className={cn("font-medium", hideAi && "text-fg")}>过滤 AI</span>
      <Switch checked={hideAi} onCheckedChange={setHideAi} aria-label="过滤 AI 作画" />
    </label>
  );
}
