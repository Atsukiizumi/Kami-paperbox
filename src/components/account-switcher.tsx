import { Check, Plus, UserRound } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { accountLabel } from "@/lib/accounts";
import { useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function AccountSwitcher() {
  const accounts = useSettings((s) => s.accounts);
  const activeAccountId = useSettings((s) => s.activeAccountId);
  const switchAccount = useSettings((s) => s.switchAccount);
  const active = accounts.find((a) => a.id === activeAccountId);

  async function choose(id: string) {
    const next = accounts.find((a) => a.id === id);
    await switchAccount(id);
    toast.success(`已切换到 ${next?.name ?? "账号"}`);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "ml-auto flex h-10 max-w-44 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted",
            "transition-colors hover:bg-elevated hover:text-fg",
          )}
        >
          <UserRound className="size-4 shrink-0" />
          <span className="truncate">{active ? active.name : "未登录"}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>账号</DropdownMenuLabel>
        {accounts.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted">还没有登录。公开内容可直接看。</p>
        ) : (
          accounts.map((acc) => (
            <DropdownMenuItem key={acc.id} onSelect={() => void choose(acc.id)}>
              {acc.id === activeAccountId ? (
                <Check className="size-4 text-accent" />
              ) : (
                <span className="size-4" />
              )}
              <span className="min-w-0 truncate">{accountLabel(acc)}</span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <Plus className="size-4" />
            管理账号
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
