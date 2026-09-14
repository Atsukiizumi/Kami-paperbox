"use client";

/**
 * 设置页（路由 /settings）。
 *
 * 作用：9 个分类分区的 hash 编排与页面骨架；共享 state（账号数组、两站
 *      Cookie、新账号名、登录中转开关）集中在这里经 props 下传分区组件。
 * 用法：app/settings/page.tsx 薄壳 re-export SettingsPage；分区实现见
 *      src/components/settings/*。
 * 为什么：分区拆文件后本文件只留分类菜单、hash 同步和账号会话逻辑
 *      （persist / 粘贴 / 登录中转）；中转对话框挂在页面级，不随分区卸载。
 */
import { Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { Button } from "@/components/ui/button";
import { SessionRelayDialog } from "@/components/session-relay";
import { ThemeSection } from "@/components/settings/appearance";
import { StorageSection } from "@/components/settings/storage";
import { BackupSection } from "@/components/settings/backup";
import { TagLexiconSection } from "@/components/settings/lexicon";
import { SearchPartition } from "@/components/settings/search";
import { AccountsPartition } from "@/components/settings/account";
import { BrowseSection } from "@/components/settings/browse";
import { ProxySection } from "@/components/settings/proxy";
import { HelpPartition } from "@/components/settings/help";
import {
  fanboxSessionValue,
  isFanboxLoggedInSession,
  isPixivLoggedInSession,
  type LoginSite,
} from "@/lib/sync/browser-login";
import { useSettings } from "@/lib/store";
import { applyCookieDump, applyLoginSession } from "@/lib/sync/apply-session";
import { cn } from "@/lib/utils";

const SETTINGS_PAGES = [
  { id: "theme", label: "外观", hint: "配色和深浅" },
  { id: "storage", label: "存储", hint: "文件夹和路径" },
  { id: "backup", label: "备份", hint: "导出和导入" },
  { id: "lexicon", label: "词表", hint: "标签译文" },
  { id: "search", label: "搜图", hint: "SauceNAO key 和 Danbooru" },
  { id: "accounts", label: "账号", hint: "登录和 Cookie" },
  { id: "browse", label: "浏览", hint: "R-18 和 AI" },
  { id: "proxy", label: "代理", hint: "出站网络" },
  { id: "help", label: "说明", hint: "怎么复制会话" },
] as const;

type SettingsPageId = (typeof SETTINGS_PAGES)[number]["id"];

function isSettingsPage(v: string): v is SettingsPageId {
  return SETTINGS_PAGES.some((p) => p.id === v);
}

function pageFromHash(): SettingsPageId {
  if (typeof window === "undefined") return "theme";
  const raw = window.location.hash.replace(/^#/, "");
  return isSettingsPage(raw) ? raw : "theme";
}

function SettingsMenu({
  page,
  onPick,
}: {
  page: SettingsPageId;
  onPick: (id: SettingsPageId) => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const current = SETTINGS_PAGES.find((item) => item.id === page);

  return (
    <>
      {/* 移动端：横向 chips 换成「分类」按钮 + 底部抽屉（纸感质感批 PR3）；
          桌面端保持纵向分类列表。 */}
      <div className="md:hidden">
        <Button variant="secondary" size="sm" className="h-8 gap-1.5" onClick={() => setDrawerOpen(true)}>
          <Menu className="size-3.5" />
          {current ? `分类 · ${current.label}` : "分类"}
        </Button>
        <Drawer.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
          <Drawer.Portal>
            <Drawer.Overlay className="kami-veil-in fixed inset-0 z-50 bg-overlay" />
            <Drawer.Content className="kami-drawer-content">
              <div className="kami-drawer-grabber" aria-hidden />
              <Drawer.Title className="font-display text-base text-fg">设置分类</Drawer.Title>
              <div className="flex flex-col gap-0.5">
                {SETTINGS_PAGES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="kami-drawer-item"
                    data-active={item.id === page}
                    onClick={() => {
                      onPick(item.id);
                      setDrawerOpen(false);
                    }}
                  >
                    <span className="text-sm text-fg">{item.label}</span>
                    <span className="text-[11px] text-subtle">{item.hint}</span>
                  </button>
                ))}
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      </div>
      <nav aria-label="设置分类" className="hidden md:block md:w-40 md:shrink-0">
        <p className="mb-2 text-[11px] tracking-wide text-subtle uppercase">分类</p>
        <ul className="flex flex-col gap-1">
          {SETTINGS_PAGES.map((item) => {
            const active = item.id === page;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onPick(item.id)}
                  className={cn(
                    "flex w-full flex-col rounded-lg px-3 py-2 text-left transition-colors",
                    active ? "bg-elevated text-fg" : "text-muted hover:bg-elevated/70 hover:text-fg",
                  )}
                >
                  <span className="text-sm">{item.label}</span>
                  <span className={cn("text-[11px]", active ? "text-subtle" : "text-subtle/80")}>
                    {item.hint}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

export function SettingsPage() {
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const fanboxCookie = useSettings((s) => s.fanboxCookie);
  const accounts = useSettings((s) => s.accounts);
  const activeAccountId = useSettings((s) => s.activeAccountId);
  const setPixivCookie = useSettings((s) => s.setPixivCookie);
  const setFanboxCookie = useSettings((s) => s.setFanboxCookie);
  const addAccount = useSettings((s) => s.addAccount);
  const renameAccount = useSettings((s) => s.renameAccount);
  const removeAccount = useSettings((s) => s.removeAccount);
  const switchAccount = useSettings((s) => s.switchAccount);
  const syncSessions = useSettings((s) => s.syncSessions);
  const refreshIdentities = useSettings((s) => s.refreshIdentities);
  const [newName, setNewName] = useState("");
  const [relaySite, setRelaySite] = useState<LoginSite | null>(null);
  const [page, setPage] = useState<SettingsPageId>("theme");

  useEffect(() => {
    setPage(pageFromHash());
    function onHash() {
      setPage(pageFromHash());
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function openPage(id: SettingsPageId) {
    setPage(id);
    if (window.location.hash !== `#${id}`) {
      window.history.replaceState(null, "", `#${id}`);
    }
  }

  const active = accounts.find((a) => a.id === activeAccountId);

  async function persist() {
    try {
      if (pixivCookie && !isPixivLoggedInSession(pixivCookie)) {
        toast.error("Pixiv Cookie 不是已登录会话。需要形如 12345678_令牌，没有下划线的是访客 Cookie。");
        return;
      }
      if (fanboxCookie && !isFanboxLoggedInSession(fanboxSessionValue(fanboxCookie))) {
        toast.error("FANBOX Cookie 不是已登录会话。需要形如 12345678_令牌的 FANBOXSESSID。");
        return;
      }
      await syncSessions();
      await refreshIdentities();
      toast.success("登录状态已保存在这台设备");
    } catch {
      toast.error("未能写入会话，图片代理可能无法使用付费内容");
    }
  }

  async function applyDump(raw: string) {
    const result = await applyCookieDump(raw);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Cookie 已写入");
  }

  /** 定向粘贴：粘进哪个框就只写哪个站，另一站的 Cookie 会提示换框。 */
  async function applyDumpFor(site: LoginSite, raw: string) {
    const result = await applyCookieDump(raw, site);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(site === "pixiv" ? "Pixiv Cookie 已写入" : "FANBOX Cookie 已写入");
  }

  async function pasteDump() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toast.error("剪贴板是空的");
        return;
      }
      await applyDump(text);
    } catch {
      toast.error("读不到剪贴板，请直接粘贴到输入框");
    }
  }

  async function applyRelay(data: {
    pixiv?: string;
    fanbox?: string;
    pixivProfile?: { id: string; name: string; avatar?: string } | null;
    fanboxProfile?: { id: string; name: string; avatar?: string } | null;
  }) {
    const result = await applyLoginSession({ ...data, accountName: newName });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const pixivName = data.pixivProfile?.name;
    const fanboxName = data.fanboxProfile?.name;
    toast.success(
      [pixivName ? `Pixiv ${pixivName}` : data.pixiv ? "Pixiv 已登录" : "", fanboxName ? `FANBOX ${fanboxName}` : data.fanbox && !pixivName ? "FANBOX 已登录" : ""]
        .filter(Boolean)
        .join(" · ") || "已写入会话",
    );
  }

  function openRelay(site: LoginSite) {
    if (!active) addAccount(newName.trim() || `账号 ${accounts.length + 1}`);
    setRelaySite(site);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="font-display text-3xl tracking-tight md:text-4xl">设置</h1>
        <p className="mt-1 text-sm text-muted">左边选分类，右边只看这一页。</p>
      </header>

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <SettingsMenu page={page} onPick={openPage} />
        <div className="min-w-0 flex-1 space-y-8">
          {page === "theme" ? <ThemeSection /> : null}
          {page === "storage" ? <StorageSection /> : null}
          {page === "backup" ? <BackupSection /> : null}
          {page === "lexicon" ? <TagLexiconSection /> : null}
          {page === "search" ? <SearchPartition /> : null}

          {page === "accounts" ? (
            <AccountsPartition
              accounts={accounts}
              activeAccountId={activeAccountId}
              pixivCookie={pixivCookie}
              fanboxCookie={fanboxCookie}
              newName={newName}
              setNewName={setNewName}
              addAccount={addAccount}
              renameAccount={renameAccount}
              removeAccount={removeAccount}
              switchAccount={switchAccount}
              setPixivCookie={setPixivCookie}
              setFanboxCookie={setFanboxCookie}
              openRelay={openRelay}
              persist={persist}
              pasteDump={pasteDump}
              applyDumpFor={applyDumpFor}
            />
          ) : null}

          <SessionRelayDialog
            site={relaySite}
            open={relaySite !== null}
            onOpenChange={(next) => {
              if (!next) setRelaySite(null);
            }}
            onDone={applyRelay}
          />

          {page === "browse" ? <BrowseSection /> : null}
          {page === "proxy" ? <ProxySection /> : null}
          {page === "help" ? <HelpPartition /> : null}
        </div>
      </div>
    </div>
  );
}
