"use client";

/**
 * 设置「账号」页。
 *
 * 作用：AppAccountSection（应用账号登录 / 推拉同步）+ AccountsPartition
 *      （Pixiv / FANBOX 多账号列表与当前账号 Cookie 表单）。
 * 用法：设置分类「账号」渲染 AccountsPartition；共享 state（账号数组、两站
 *      Cookie、新账号名）由设置页经 props 下传，登录中转对话框仍留在设置页。
 * 为什么：账号分区要读写 store 的账号面，但 openRelay / applyRelay 等入口
 *      与页面级 relaySite 状态耦合，逻辑留在设置页、分区只收数据与回调。
 */
import { ClipboardPaste, LogIn, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppAccountSignInForm } from "@/components/app-account-signin";
import { SiteAvatar } from "@/components/site-avatar";
import { signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  accountLabel,
  displayName,
  siteProfile,
  type Account,
} from "@/lib/sync/accounts";
import {
  fanboxSessionValue,
  isFanboxLoggedInSession,
  isPixivLoggedInSession,
  parseCookieDump,
  pixivUserIdFromCookie,
  type LoginSite,
} from "@/lib/sync/browser-login";
import { pullAccountSync, pushAccountSyncSegment, readSyncMarkers, SYNC_SEGMENTS } from "@/lib/sync/account-sync";
import { mask } from "./mask";
import { cn } from "@/lib/utils";

/**
 * 应用账号：纸匣自己的登录（邮箱 + 密码），和 Pixiv / FANBOX 账号是两回事。
 *
 * 作用：登录后设置自动同步到本机服务端（`.data/pglite`），换浏览器 / 换设备登录
 *      同一账号即可恢复各图站 Cookie、词表、纸匣索引和历史。
 * 为什么：这些数据原本只在浏览器 localStorage 里，清站点数据或换浏览器就没了；
 *        备份文件要手动搬运，这份跟着账号走。
 */
function AppAccountSection() {
  const { user, isPending } = useCurrentUserState();
  const signedIn = Boolean(user && !user.isDevFallback);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastSync, setLastSync] = useState<number | null>(null);

  useEffect(() => {
    setLastSync(Math.max(0, ...Object.values(readSyncMarkers()?.marks ?? { _: 0 })) || null);
  }, [user?.id]);

  async function sync(direction: "push" | "pull") {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      if (direction === "push") {
        const pushed: string[] = [];
        for (const segment of SYNC_SEGMENTS) {
          if (await pushAccountSyncSegment(user.id, segment)) pushed.push(segment);
        }
        toast.success(pushed.length ? `已同步 ${pushed.length}/4 段到本机服务端` : "没有可同步的段（设置段需登录后才能推）");
      } else {
        const r = await pullAccountSync(user.id, { force: true });
        toast[r.applied.length ? "success" : "info"](r.applied.length ? `已从服务端恢复 ${r.applied.length} 段` : "服务端没有存档");
      }
      setLastSync(Math.max(0, ...Object.values(readSyncMarkers()?.marks ?? { _: 0 })) || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>应用账号</CardTitle>
        <CardDescription>
          纸匣自己的账号（邮箱 + 密码）。登录后设置自动同步到本机服务端：换浏览器、换设备，
          登录同一账号就把各图站 Cookie、词表、纸匣索引和历史带回来。数据只存这台机器的 `.data`。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isPending ? (
          <p className="text-sm text-muted">正在读取登录状态…</p>
        ) : signedIn ? (
          <>
            <p className="text-sm">
              已登录 <span className="text-fg">{user?.primaryEmail ?? user?.displayName ?? user?.id}</span>
              {lastSync ? (
                <span className="ml-2 text-xs text-subtle">
                  上次同步 {new Date(lastSync).toLocaleString("zh-CN", { hour12: false })}
                </span>
              ) : (
                <span className="ml-2 text-xs text-subtle">还没有同步记录</span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={busy} onClick={() => void sync("push")}>
                同步到服务端
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void sync("pull")}>
                从服务端恢复
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  void signOut().catch(() => undefined);
                }}
              >
                登出
              </Button>
            </div>
          </>
        ) : (
          <AppAccountSignInForm />
        )}
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

export function AccountsPartition({
  accounts,
  activeAccountId,
  pixivCookie,
  fanboxCookie,
  newName,
  setNewName,
  addAccount,
  renameAccount,
  removeAccount,
  switchAccount,
  setPixivCookie,
  setFanboxCookie,
  openRelay,
  persist,
  pasteDump,
  applyDumpFor,
}: {
  accounts: Account[];
  activeAccountId: string | null;
  pixivCookie: string;
  fanboxCookie: string;
  newName: string;
  setNewName: (v: string) => void;
  addAccount: (name: string) => string;
  renameAccount: (id: string, name: string) => void;
  removeAccount: (id: string) => void;
  switchAccount: (id: string) => Promise<void>;
  setPixivCookie: (v: string) => void;
  setFanboxCookie: (v: string) => void;
  openRelay: (site: LoginSite) => void;
  persist: () => Promise<void>;
  pasteDump: () => Promise<void>;
  applyDumpFor: (site: LoginSite, raw: string) => Promise<void>;
}) {
  const active = accounts.find((a) => a.id === activeAccountId);

  return (
    <div className="space-y-8">
      <AppAccountSection />
      <Card>
        <CardHeader>
          <CardTitle>账号</CardTitle>
          <CardDescription>
            可以保存多个 Pixiv / FANBOX 登录，顶栏随时切换。Cookie 只留在这台设备上。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1">
            {accounts.map((acc) => (
              <li key={acc.id}>
                <button
                  type="button"
                  onClick={() => {
                    void switchAccount(acc.id).then(() =>
                      toast.success(`已切换到 ${acc.name}`),
                    );
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                    acc.id === activeAccountId
                      ? "bg-elevated text-fg"
                      : "text-muted hover:bg-elevated hover:text-fg",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex -space-x-1.5">
                      <SiteAvatar profile={siteProfile(acc, "pixiv")} size="sm" />
                      <SiteAvatar profile={siteProfile(acc, "fanbox")} size="sm" className="ring-2 ring-surface" />
                    </span>
                    <span className="min-w-0 truncate">{accountLabel(acc)}</span>
                  </span>
                  {acc.id === activeAccountId ? (
                    <span className="text-xs text-accent">当前</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="新账号名称，例如 主号"
            />
            <Button
              variant="secondary"
              onClick={() => {
                addAccount(newName.trim() || `账号 ${accounts.length + 1}`);
                setNewName("");
                toast.success("已添加账号，登录或粘贴 Cookie 后保存");
              }}
            >
              <Plus className="size-4" />
              添加
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>当前账号 Cookie</CardTitle>
        </CardHeader>
        <CardContent>
          {active ? (
            <div className="space-y-3">
              <div>
                <Label htmlFor="acc-name">名称</Label>
                <Input
                  id="acc-name"
                  value={active.name}
                  onChange={(e) => renameAccount(active.id, e.target.value)}
                />
              </div>
              <p className="text-xs leading-relaxed text-subtle">
                两个站各自独立：填哪个、登录哪个，只影响那个站。只登 Pixiv 也能浏览 FANBOX 公开内容。
              </p>
              <section className="space-y-2 rounded-lg border border-fg/10 p-4">
                <div className="flex items-start gap-3">
                  <SiteAvatar profile={siteProfile(active, "pixiv")} size="lg" />
                  <div className="min-w-0 flex-1">
                    <Label className="text-sm font-medium text-fg" htmlFor="pixiv-cookie">
                      Pixiv
                    </Label>
                    <p className="mt-0.5 text-sm text-fg">{displayName(active, "pixiv")}</p>
                    {active.pixivProfile?.id ? (
                      <p className="text-xs text-subtle">ID {active.pixivProfile.id}</p>
                    ) : pixivUserIdFromCookie(pixivCookie) ? (
                      <p className="text-xs text-subtle">已识别用户 ID {pixivUserIdFromCookie(pixivCookie)}</p>
                    ) : null}
                    <p className="text-xs text-subtle">{mask(pixivCookie)}</p>
                  </div>
                </div>
                <Input
                  id="pixiv-cookie"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="从 pixiv.net Cookie 复制 PHPSESSID"
                  value={pixivCookie}
                  onChange={(e) => setPixivCookie(e.target.value.trim())}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text");
                    const parsed = parseCookieDump(text);
                    if (parsed.pixiv || isPixivLoggedInSession(text)) {
                      e.preventDefault();
                      void applyDumpFor("pixiv", text);
                    } else if (parsed.fanbox || isFanboxLoggedInSession(fanboxSessionValue(text))) {
                      e.preventDefault();
                      toast.error("这串是 FANBOX 的 Cookie——请粘到下面 FANBOX 框里。");
                    }
                  }}
                />
                <Button variant="secondary" onClick={() => openRelay("pixiv")}>
                  <LogIn className="size-4" />
                  登录 Pixiv
                </Button>
              </section>
              <section className="space-y-2 rounded-lg border border-fg/10 p-4">
                <div className="flex items-start gap-3">
                  <SiteAvatar profile={siteProfile(active, "fanbox")} size="lg" />
                  <div className="min-w-0 flex-1">
                    <Label className="text-sm font-medium text-fg" htmlFor="fanbox-cookie">
                      FANBOX
                    </Label>
                    <p className="mt-0.5 text-sm text-fg">{displayName(active, "fanbox")}</p>
                    {active.fanboxProfile?.id ? (
                      <p className="text-xs text-subtle">ID {active.fanboxProfile.id}</p>
                    ) : null}
                    <p className="text-xs text-subtle">{mask(fanboxCookie)}</p>
                  </div>
                </div>
                <Input
                  id="fanbox-cookie"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="从 fanbox.cc Cookie 复制 FANBOXSESSID"
                  value={fanboxCookie}
                  onChange={(e) => setFanboxCookie(e.target.value.trim())}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text");
                    const parsed = parseCookieDump(text);
                    if (parsed.fanbox || isFanboxLoggedInSession(fanboxSessionValue(text))) {
                      e.preventDefault();
                      void applyDumpFor("fanbox", text);
                    } else if (parsed.pixiv || isPixivLoggedInSession(text)) {
                      e.preventDefault();
                      toast.error("这串是 Pixiv 的 Cookie——请粘到上面 Pixiv 框里。");
                    }
                  }}
                />
                <Button variant="secondary" onClick={() => openRelay("fanbox")}>
                  <LogIn className="size-4" />
                  登录 FANBOX
                </Button>
              </section>
              <p className="text-xs leading-relaxed text-subtle">
                「登录」会在这个页面里打开官方登录页。FANBOX 会先到 Pixiv 选账号，再回转
                <span className="text-fg"> /auth/start </span>
                把会话带回来。也可以把 PHPSESSID、FANBOXSESSID、Cookie 导出 JSON 或 Netscape cookies.txt 粘进对应的框。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void persist()}>保存登录状态</Button>
                <Button variant="ghost" onClick={() => void pasteDump()}>
                  <ClipboardPaste className="size-4" />
                  从剪贴板粘贴（整份）
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    removeAccount(active.id);
                    toast.success("已删除账号");
                  }}
                >
                  <Trash2 className="size-4" />
                  删除此账号
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted">还没有账号。登录成功后会自动建一个。</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => openRelay("pixiv")}>
                  <LogIn className="size-4" />
                  登录 Pixiv
                </Button>
                <Button variant="secondary" onClick={() => openRelay("fanbox")}>
                  <LogIn className="size-4" />
                  登录 FANBOX
                </Button>
                <Button variant="ghost" onClick={() => void pasteDump()}>
                  <ClipboardPaste className="size-4" />
                  从剪贴板粘贴
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
