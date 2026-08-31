import { Check, ChevronDown } from "lucide-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { SiteAvatar } from "@/components/site-avatar";
import { siteProfile } from "@/lib/accounts";
import { SITE_LIST, siteLabel } from "@/lib/sites";
import { useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function SiteSwitcher({ className }: { className?: string }) {
  const tab = useSettings((s) => s.tab);
  const setTab = useSettings((s) => s.setTab);
  const setBrowseQuery = useSettings((s) => s.setBrowseQuery);
  const accounts = useSettings((s) => s.accounts);
  const activeAccountId = useSettings((s) => s.activeAccountId);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = accounts.find((a) => a.id === activeAccountId);
  const currentProfile =
    tab === "pixiv" || tab === "fanbox" ? siteProfile(active, tab) : undefined;

  function choose(id: (typeof SITE_LIST)[number]["id"]) {
    setTab(id);
    setBrowseQuery("");
    if (pathname !== "/") void navigate({ to: "/" });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-fg",
            "hover:bg-elevated",
            className,
          )}
          aria-label="切换图源"
        >
          {tab === "pixiv" || tab === "fanbox" ? <SiteAvatar profile={currentProfile} size="sm" /> : null}
          <span className="max-w-28 truncate">{siteLabel(tab)}</span>
          {currentProfile?.name ? (
            <span className="hidden max-w-24 truncate text-xs font-normal text-muted sm:inline">
              {currentProfile.name}
            </span>
          ) : null}
          <ChevronDown className="size-3.5 text-muted" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>图源</DropdownMenuLabel>
        {SITE_LIST.map((site) => {
          const profile = site.id === "pixiv" || site.id === "fanbox" ? siteProfile(active, site.id) : undefined;
          return (
            <DropdownMenuItem key={site.id} onSelect={() => choose(site.id)}>
              {tab === site.id ? <Check className="size-4 text-accent" /> : <span className="size-4" />}
              {site.id === "pixiv" || site.id === "fanbox" ? <SiteAvatar profile={profile} size="sm" /> : null}
              <span className="flex min-w-0 flex-col">
                <span>{site.label}</span>
                {profile?.name ? <span className="text-[10px] text-subtle">{profile.name}</span> : null}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
