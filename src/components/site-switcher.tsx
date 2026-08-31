/**
 * 顶栏图源切换。
 *
 * 作用：在 Pixiv / FANBOX / 图站之间切换，并回到浏览页。
 * 用法：放在顶栏 logo 右侧。触发器只显示站点名，不显示用户资料。
 * 为什么：把用户头像和名字塞进触发器会把「Pixiv」挤成「P..」。账号归右侧 AccountSwitcher。
 */
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SITE_LIST, siteLabel } from "@/lib/sites";
import { useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { Source } from "@/lib/types";

function SiteMark({ id, className }: { id: Source; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-elevated text-[10px] font-medium text-fg",
        className,
      )}
      aria-hidden
    >
      {siteLabel(id).slice(0, 1)}
    </span>
  );
}

export function SiteSwitcher({ className }: { className?: string }) {
  const tab = useSettings((s) => s.tab);
  const setTab = useSettings((s) => s.setTab);
  const setBrowseQuery = useSettings((s) => s.setBrowseQuery);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  function choose(id: string) {
    setTab(id as Source);
    setBrowseQuery("");
    if (pathname !== "/") void navigate({ to: "/" });
  }

  return (
    <Select value={tab} onValueChange={choose}>
      <SelectTrigger className={cn("w-auto shrink-0", className)} aria-label="切换图源">
        <SiteMark id={tab} />
        <SelectValue>{siteLabel(tab)}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        {SITE_LIST.map((site) => (
          <SelectItem key={site.id} value={site.id}>
            <span className="flex items-center gap-2">
              <SiteMark id={site.id} />
              {site.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
