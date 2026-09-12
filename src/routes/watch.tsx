"use client";

/**
 * 画师更新追踪页（A）。
 *
 * 作用：列出追踪的画师，按需检查更新（逐画师拉最新页，吃服务端缓存），
 *      显示新作数/失败态/最新缩略图；单个或全部标已读；一键导入 pixiv 关注。
 * 数据：追踪列表与水位在设置段（跨设备同步）；角标数本机 localStorage。
 */
import { useEffect, useState } from "react";
import { Link } from "@/lib/kami-link";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Bell, UserPlus } from "lucide-react";
import { useSettings } from "@/lib/store";
import { setWatchBadge, useWatchBadge } from "@/lib/watch-badge";
import { checkWatchArtists, totalNew, type WatchCheckResult } from "@/lib/watch-check";
import { WATCH_DEFAULT_LIMIT, WATCH_MAX_LIMIT, WATCH_MIN_LIMIT, clampWatchLimit } from "@/lib/watch";
import { cookiesFromSettings } from "@/lib/store";
import { fetchSource } from "@/lib/source";

export function WatchPage() {
  const watchArtists = useSettings((s) => s.watchArtists);
  const watchLimit = useSettings((s) => s.watchLimit);
  const setWatchSeen = useSettings((s) => s.setWatchSeen);
  const toggleWatchArtist = useSettings((s) => s.toggleWatchArtist);
  const setWatchLimit = useSettings((s) => s.setWatchLimit);
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const badge = useWatchBadge((s) => s.newCount);

  const [results, setResults] = useState<Record<string, WatchCheckResult>>({});
  const [checking, setChecking] = useState(false);

  const keyOf = (source: string, id: string) => `${source}:${id}`;

  async function checkAll() {
    if (watchArtists.length === 0 || checking) return;
    setChecking(true);
    try {
      const list = await checkWatchArtists(watchArtists, cookiesFromSettings());
      const map: Record<string, WatchCheckResult> = {};
      for (const r of list) map[keyOf(r.source, r.id)] = r;
      setResults(map);
      const unread = totalNew(list);
      setWatchBadge(unread);
      if (unread > 0) toast.success(`${unread} 张新作品`);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void checkAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function importFollowing() {
    if (!pixivCookie) {
      toast.error("先在设置里添加 Pixiv 账号");
      return;
    }
    const existing = new Set(watchArtists.map((w) => keyOf(w.source, w.id)));
    const merged: { source: "pixiv"; id: string; name: string; avatar: string }[] = [];
    for (let page = 1; page <= Math.ceil(watchLimit / 24) + 1; page += 1) {
      const r = await fetchSource({ data: { op: "pixivMyFollowing", page, ...cookiesFromSettings() } });
      if (r.op !== "pixivMyFollowing") break;
      for (const u of r.items) {
        if (existing.has(keyOf("pixiv", u.id)) || merged.some((m) => m.id === u.id)) continue;
        merged.push({ source: "pixiv", id: u.id, name: u.name, avatar: u.avatar });
      }
      if (!r.nextPage || watchArtists.length + merged.length >= watchLimit) break;
    }
    if (merged.length === 0) {
      toast.info("关注里的画师都已在追踪中");
      return;
    }
    let added = 0;
    for (const a of merged) {
      if (useSettings.getState().watchArtists.length >= watchLimit) break;
      toggleWatchArtist(a);
      added += 1;
    }
    toast.success(`已导入 ${added} 位画师`);
  }

  function markAllSeen() {
    let n = 0;
    for (const artist of watchArtists) {
      const r = results[keyOf(artist.source, artist.id)];
      if (r?.newestId && artist.lastSeenId !== r.newestId) {
        setWatchSeen(artist.source, artist.id, r.newestId);
        n += 1;
      }
    }
    setWatchBadge(0);
    if (n > 0) toast.success(`已读 ${n} 位画师的更新`);
  }

  const unreadTotal = Object.values(results).reduce((sum, r) => sum + (r.error ? 0 : r.newCount), 0);
  const failing = Object.values(results).filter((r) => r.error);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="font-display text-3xl tracking-tight md:text-4xl">追踪</h1>
        <p className="text-sm text-muted">
          {watchArtists.length}/{watchLimit} 位画师
          {unreadTotal > 0 ? ` · ${unreadTotal} 张新作品` : ""}
          {" · 检查会拉取各画师最新作品并缓存到服务端（受缓存水位自动清理），追踪越多占用与流量越大。"}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void checkAll()} disabled={checking || watchArtists.length === 0}>
          <Bell className="size-4" />
          {checking ? "检查中…" : "检查更新"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void importFollowing()}>
          <UserPlus className="size-4" />
          导入 Pixiv 关注
        </Button>
        <Button size="sm" variant="ghost" onClick={markAllSeen} disabled={unreadTotal === 0}>
          全部标为已读
        </Button>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted">
          上限
          <input
            type="number"
            min={WATCH_MIN_LIMIT}
            max={WATCH_MAX_LIMIT}
            value={watchLimit}
            onChange={(e) => {
              const v = clampWatchLimit(Number(e.target.value) || WATCH_DEFAULT_LIMIT);
              setWatchLimit(v);
            }}
            className="h-8 w-20 rounded-md bg-elevated px-2 text-right tabular-nums text-fg"
          />
        </label>
      </div>

      {failing.length > 0 ? (
        <Alert>
          <AlertTitle>{failing.length} 位画师检查失败</AlertTitle>
          <AlertDescription>
            {failing
              .slice(0, 3)
              .map((r) => `${r.id}: ${r.error}`)
              .join("；")}
            {failing.length > 3 ? "…" : ""}（多为 Cookie 失效，去设置里更新）
          </AlertDescription>
        </Alert>
      ) : null}

      {watchArtists.length === 0 ? (
        <Alert>
          <AlertTitle>还没有追踪的画师</AlertTitle>
          <AlertDescription>
            去画师页点「追踪」，或用上面的按钮一键导入 Pixiv 关注。
          </AlertDescription>
        </Alert>
      ) : (
        <ul className="space-y-2">
          {watchArtists.map((artist) => {
            const r = results[keyOf(artist.source, artist.id)];
            const href = artist.source === "pixiv" ? `/user/${artist.id}` : `/creator/${artist.id}`;
            return (
              <li key={keyOf(artist.source, artist.id)} className="flex items-center gap-3 rounded-lg bg-elevated/50 p-3">
                <Link to={href} className="flex min-w-0 flex-1 items-center gap-3">
                  {artist.avatar ? (
                    <img src={artist.avatar} alt="" className="size-10 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-fg/10 text-xs">画</span>
                  )}
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{artist.name || artist.id}</span>
                      <span className="shrink-0 rounded-full bg-fg/5 px-2 text-[10px] text-muted">{artist.source}</span>
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {checking && !r
                        ? "检查中…"
                        : r?.error
                          ? `检查失败：${r.error}`
                          : r
                            ? r.newCount > 0
                              ? `${r.newCount} 张新作品`
                              : "没有新作品"
                            : "还没检查过"}
                    </span>
                  </span>
                </Link>
                {r?.latestThumb && !r.error ? (
                  <img src={r.latestThumb} alt="" className="hidden h-12 w-12 shrink-0 rounded-md object-cover sm:block" />
                ) : null}
                {r && !r.error && r.newCount > 0 && r.newestId ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setWatchSeen(artist.source, artist.id, r.newestId!);
                      setResults((prev) => ({ ...prev, [keyOf(artist.source, artist.id)]: { ...r, newCount: 0 } }));
                      setWatchBadge(Math.max(0, badge - r.newCount));
                    }}
                  >
                    标为已读
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    toggleWatchArtist({ source: artist.source, id: artist.id, name: artist.name, avatar: artist.avatar });
                    toast.success("已取消追踪");
                  }}
                >
                  取消
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
