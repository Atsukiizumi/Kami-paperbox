import { Check, ChevronDown } from "lucide-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
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
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

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
            "flex h-10 items-center gap-1 rounded-lg px-2.5 text-sm font-medium text-fg",
            "hover:bg-elevated",
            className,
          )}
          aria-label="切换图源"
        >
          <span className="max-w-28 truncate">{siteLabel(tab)}</span>
          <ChevronDown className="size-3.5 text-muted" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>图源</DropdownMenuLabel>
        {SITE_LIST.map((site) => (
          <DropdownMenuItem key={site.id} onSelect={() => choose(site.id)}>
            {tab === site.id ? <Check className="size-4 text-accent" /> : <span className="size-4" />}
            {site.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
