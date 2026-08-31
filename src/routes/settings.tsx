import { createFileRoute } from "@tanstack/react-router";
import { LogIn, Plus, Trash2, X } from "lucide-react";
import { isAbortError } from "@/lib/error-component";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { accountLabel, displayName, siteProfile } from "@/lib/accounts";
import { SiteAvatar } from "@/components/site-avatar";
import { ThemeSection } from "@/components/theme-picker";
import { StorageSection } from "@/components/storage-settings";
import { useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function mask(value: string): string {
  if (!value) return "未填写";
  if (value.length <= 6) return "已保存";
  return `已保存 · …${value.slice(-4)}`;
}

function sourceLabel(source: string): string {
  if (source === "saved") return "已保存在本机";
  if (source === "config") return "来自 kami.config.json";
  if (source === "env") return "来自环境变量";
  return "未使用";
}

function ProxySection() {
  const [url, setUrl] = useState("");
  const [source, setSource] = useState("none");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await fetch("/api/proxy");
    const data = (await res.json()) as { url?: string; source?: string };
    setUrl(data.url ?? "");
    setSource(data.source ?? "none");
  }

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, []);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/proxy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; url?: string; source?: string };
      if (!res.ok || data.ok === false) throw new Error(data.error || "保存失败");
      setUrl(data.url ?? "");
      setSource(data.source ?? "saved");
      toast.success(data.url ? "代理已写入 kami.config.json，立即生效" : "已关闭自定义代理");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function probe() {
    setBusy(true);
    try {
      const res = await fetch("/api/proxy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ probe: true, url }),
      });
      const data = (await res.json()) as {
        error?: string;
        probe?: { ok?: boolean; message?: string };
      };
      if (!res.ok) throw new Error(data.error || "探测失败");
      if (data.probe?.ok) toast.success(data.probe.message || "代理可用");
      else toast.error(data.probe?.message || data.error || "代理不通");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "探测失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl bg-surface p-4">
      <h2 className="text-sm font-medium">网络代理</h2>
      <p className="text-sm leading-relaxed text-muted">
        拉取 Pixiv、FANBOX、图站和搜图时走这个地址。支持 http、https、socks5，例如
        <span className="text-fg"> 127.0.0.1:7890</span> 或{" "}
        <span className="text-fg">socks5://127.0.0.1:1080</span>。
        点保存会写入本机 <span className="text-fg">kami.config.json</span>，重启后也还在。
      </p>
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="http://127.0.0.1:7890"
        autoComplete="off"
        spellCheck={false}
        aria-label="代理地址"
      />
      <p className="text-xs text-subtle">{sourceLabel(source)}</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={busy}>
          保存代理
        </Button>
        <Button variant="secondary" onClick={() => void probe()} disabled={busy}>
          检测连通
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setUrl("");
            void (async () => {
              setBusy(true);
              try {
                await fetch("/api/proxy", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ clear: true }),
                });
                setSource("none");
                toast.success("已清除本机代理");
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          清除
        </Button>
      </div>
    </section>
  );
}

function SettingsPage() {
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const fanboxCookie = useSettings((s) => s.fanboxCookie);
  const safeMode = useSettings((s) => s.safeMode);
  const hideAi = useSettings((s) => s.hideAi);
  const downloadOriginal = useSettings((s) => s.downloadOriginal);
  const accounts = useSettings((s) => s.accounts);
  const activeAccountId = useSettings((s) => s.activeAccountId);
  const setPixivCookie = useSettings((s) => s.setPixivCookie);
  const setFanboxCookie = useSettings((s) => s.setFanboxCookie);
  const setSafeMode = useSettings((s) => s.setSafeMode);
  const setHideAi = useSettings((s) => s.setHideAi);
  const setDownloadOriginal = useSettings((s) => s.setDownloadOriginal);
  const addAccount = useSettings((s) => s.addAccount);
  const renameAccount = useSettings((s) => s.renameAccount);
  const removeAccount = useSettings((s) => s.removeAccount);
  const switchAccount = useSettings((s) => s.switchAccount);
  const syncSessions = useSettings((s) => s.syncSessions);
  const applyProfiles = useSettings((s) => s.applyProfiles);
  const refreshIdentities = useSettings((s) => s.refreshIdentities);
  const [newName, setNewName] = useState("");
  const [loginBusy, setLoginBusy] = useState<"pixiv" | "fanbox" | null>(null);

  const active = accounts.find((a) => a.id === activeAccountId);

  async function persist() {
    try {
      await syncSessions();
      await refreshIdentities();
      toast.success("登录状态已保存在这台设备");
    } catch {
      toast.error("未能写入会话，图片代理可能无法使用付费内容");
    }
  }

  async function browserLogin(site: "pixiv" | "fanbox") {
    if (!active) {
      addAccount(newName.trim() || `账号 ${accounts.length + 1}`);
    }
    setLoginBusy(site);
    toast.message("正在打开系统浏览器的官方登录页…网页里嵌不进 Pixiv。");
    try {
      try {
        const res = await fetch("/api/login-browser", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ site }),
        });
        const data = (await res.json()) as {
          status?: string;
          error?: string;
          ok?: boolean;
          pixiv?: string;
          fanbox?: string;
          pixivProfile?: { id: string; name: string; avatar?: string } | null;
          fanboxProfile?: { id: string; name: string; avatar?: string } | null;
        };
        if (data.status === "error") throw new Error(data.error || "登录失败");
        if (data.status === "done") {
          await applyLoginJob(data);
          return;
        }
      } catch (err) {
        if (!isAbortError(err) && !(err instanceof TypeError)) throw err;
      }

      const deadline = Date.now() + 4 * 60 * 1000;
      let sawWaiting = false;
      while (Date.now() < deadline) {
        const res = await fetch("/api/login-browser", { cache: "no-store" });
        const data = (await res.json()) as {
          status?: string;
          error?: string;
          chrome?: string | null;
          pixiv?: string;
          fanbox?: string;
          pixivProfile?: { id: string; name: string; avatar?: string } | null;
          fanboxProfile?: { id: string; name: string; avatar?: string } | null;
        };
        if (data.status === "waiting" && !sawWaiting) {
          sawWaiting = true;
          toast.message(
            data.chrome
              ? `请在弹出的窗口里登录。找不到的话看任务栏（${data.chrome}）。`
              : "请在弹出的 Chrome / Edge 窗口里登录。找不到的话看一下任务栏。",
          );
        }
        if (data.status === "done") {
          await applyLoginJob(data);
          return;
        }
        if (data.status === "error") throw new Error(data.error || "登录失败");
        await new Promise((r) => setTimeout(r, 900));
      }
      throw new Error("等待登录超时。请确认弹出窗口里已经登录，或改用手贴 Cookie。");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoginBusy(null);
    }
  }

  async function applyLoginJob(data: {
    pixiv?: string;
    fanbox?: string;
    pixivProfile?: { id: string; name: string; avatar?: string } | null;
    fanboxProfile?: { id: string; name: string; avatar?: string } | null;
  }) {
    if (data.pixiv) setPixivCookie(data.pixiv);
    if (data.fanbox) setFanboxCookie(data.fanbox);
    applyProfiles({ pixiv: data.pixivProfile ?? null, fanbox: data.fanboxProfile ?? null });
    if (!data.pixivProfile && !data.fanboxProfile) await refreshIdentities();
    await useSettings.getState().syncSessions();
    const pixivName = data.pixivProfile?.name;
    const fanboxName = data.fanboxProfile?.name;
    toast.success(
      [pixivName ? `Pixiv ${pixivName}` : data.pixiv ? "Pixiv 已登录" : "", fanboxName ? `FANBOX ${fanboxName}` : data.fanbox && !pixivName ? "FANBOX 已登录" : ""]
        .filter(Boolean)
        .join(" · ") || "已写入会话",
    );
  }

  async function cancelBrowserLogin() {
    try {
      await fetch("/api/login-browser", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
    } catch {
      /* ignore */
    }
    setLoginBusy(null);
    toast.message("已取消浏览器登录");
  }

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <header>
        <h1 className="font-display text-3xl tracking-tight md:text-4xl">设置</h1>
      </header>

      <ThemeSection />

      <StorageSection />

      <section className="space-y-3 rounded-xl bg-surface p-5">
        <h2 className="text-sm font-medium">账号</h2>
        <p className="text-sm leading-relaxed text-muted">
          可以保存多个 Pixiv / FANBOX 登录，顶栏随时切换。Cookie 只留在这台设备上。
        </p>
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
              toast.success("已添加账号，填入 Cookie 后点保存");
            }}
          >
            <Plus className="size-4" />
            添加
          </Button>
        </div>
      </section>

      <section className="space-y-3 rounded-xl bg-surface p-5">
        <h2 className="text-sm font-medium">当前账号 Cookie</h2>
        {active ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted" htmlFor="acc-name">
                名称
              </label>
              <Input
                id="acc-name"
                value={active.name}
                onChange={(e) => renameAccount(active.id, e.target.value)}
              />
            </div>
            <div className="flex items-start gap-3">
              <SiteAvatar profile={siteProfile(active, "pixiv")} size="lg" />
              <div className="min-w-0 flex-1">
              <label className="text-sm font-medium" htmlFor="pixiv-cookie">
                Pixiv
              </label>
              <p className="mt-0.5 text-sm text-fg">{displayName(active, "pixiv")}</p>
              {active.pixivProfile?.id ? (
                <p className="text-xs text-subtle">ID {active.pixivProfile.id}</p>
              ) : null}
              <p className="text-xs text-subtle">{mask(pixivCookie)}</p>
              <Input
                id="pixiv-cookie"
                className="mt-1"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="从 pixiv.net Cookie 复制 PHPSESSID"
                value={pixivCookie}
                onChange={(e) => setPixivCookie(e.target.value.trim())}
              />
              </div>
            </div>
            <div className="flex items-start gap-3">
              <SiteAvatar profile={siteProfile(active, "fanbox")} size="lg" />
              <div className="min-w-0 flex-1">
              <label className="text-sm font-medium" htmlFor="fanbox-cookie">
                FANBOX
              </label>
              <p className="mt-0.5 text-sm text-fg">{displayName(active, "fanbox")}</p>
              {active.fanboxProfile?.id ? (
                <p className="text-xs text-subtle">ID {active.fanboxProfile.id}</p>
              ) : null}
              <p className="text-xs text-subtle">{mask(fanboxCookie)}</p>
              <Input
                id="fanbox-cookie"
                className="mt-1"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="从 fanbox.cc 复制 FANBOXSESSID"
                value={fanboxCookie}
                onChange={(e) => setFanboxCookie(e.target.value.trim())}
              />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={loginBusy !== null}
                onClick={() => void browserLogin("pixiv")}
              >
                <LogIn className="size-4" />
                {loginBusy === "pixiv" ? "等待 Pixiv 登录…" : "浏览器登录 Pixiv"}
              </Button>
              <Button
                variant="secondary"
                disabled={loginBusy !== null}
                onClick={() => void browserLogin("fanbox")}
              >
                <LogIn className="size-4" />
                {loginBusy === "fanbox" ? "等待 FANBOX 登录…" : "浏览器登录 FANBOX"}
              </Button>
              {loginBusy ? (
                <Button variant="danger" onClick={() => void cancelBrowserLogin()}>
                  <X className="size-4" />
                  取消弹窗
                </Button>
              ) : null}
            </div>
            <p className="text-xs leading-relaxed text-subtle">
              网页无法嵌入 Pixiv 登录框，也不能跨站读取 Cookie。会在本机弹出 Chrome / Edge
              打开官方登录页；密码只打在官方站点上。登录成功后只把会话 Cookie 写回当前账号。找不到窗口的话，看任务栏。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void persist()}>保存登录状态</Button>
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
            <p className="text-sm text-muted">还没有账号。可以先弹出官方登录页，成功后会自动建一个。</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={loginBusy !== null}
                onClick={() => void browserLogin("pixiv")}
              >
                <LogIn className="size-4" />
                {loginBusy === "pixiv" ? "等待 Pixiv 登录…" : "浏览器登录 Pixiv"}
              </Button>
              <Button
                variant="secondary"
                disabled={loginBusy !== null}
                onClick={() => void browserLogin("fanbox")}
              >
                <LogIn className="size-4" />
                {loginBusy === "fanbox" ? "等待 FANBOX 登录…" : "浏览器登录 FANBOX"}
              </Button>
              {loginBusy ? (
                <Button variant="danger" onClick={() => void cancelBrowserLogin()}>
                  <X className="size-4" />
                  取消弹窗
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">R-18 内容</p>
            <p className="text-xs text-muted">默认关闭。打开后显示成人向作品。涉及未成年人的内容始终过滤。</p>
          </div>
          <Switch checked={!safeMode} onCheckedChange={(on) => setSafeMode(!on)} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">过滤 AI 作画</p>
            <p className="text-xs text-muted">打开后隐藏 Pixiv 标记为 AI 生成的作品。关闭时卡片会打 AI 标签。</p>
          </div>
          <Switch checked={hideAi} onCheckedChange={setHideAi} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">保存原图 / 高清 GIF</p>
            <p className="text-xs text-muted">动图会合成 GIF。关闭则用较小尺寸，速度更快。</p>
          </div>
          <Switch checked={downloadOriginal} onCheckedChange={setDownloadOriginal} />
        </div>
      </section>

      <ProxySection />

      <section className="space-y-3 rounded-xl bg-surface p-5">
        <h2 className="text-sm font-medium">使用说明</h2>
        <p className="text-sm leading-relaxed text-muted">
          公开榜单、Yande / Konachan / Danbooru 不需要登录。备份 Pixiv 收藏、R-18 或已订阅的 FANBOX 时，填入自己的会话 Cookie。Pixiv 动图可播放并保存为 GIF。
        </p>
        <p className="text-sm leading-relaxed text-muted">
          请尊重作者版权，不要转载或商用。只保存你已经有权查看的内容。
        </p>
      </section>

      <section className="space-y-2 text-sm text-muted">
        <h2 className="text-sm font-medium text-fg">怎样复制 Cookie</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>在电脑浏览器登录 pixiv.net 或 fanbox.cc。</li>
          <li>打开开发者工具 → Application / 存储 → Cookies。</li>
          <li>复制 PHPSESSID 或 FANBOXSESSID 的值，粘贴到当前账号。</li>
          <li>Cookie 只存在你的浏览器里，不会进数据库。</li>
        </ol>
      </section>
    </div>
  );
}
