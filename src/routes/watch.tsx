"use client";

/**
 * 追踪页（A）：画师 + 标签两视图。
 *
 * 作用：列出追踪的画师/订阅的标签，按需检查更新（逐条拉最新页，吃服务端缓存），
 *      显示新作数/失败态/最新缩略图；单个或全部标已读；画师一键导入 pixiv 关注、
 *      标签手动添加或浏览页快捷订阅。
 * 数据：追踪列表与水位在设置段（跨设备同步）；角标数本机 localStorage（画师+标签合计）。
 * 为什么分段不改路由：画师与标签共享检查/红点/标已读管线，ToggleGroup 切视图
 *      比两页便宜；「去浏览」用 setTab + setBrowseQuery 走既有搜索通道。
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "@/lib/kami-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Bell, Hash, UserPlus } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSettings } from "@/lib/store";
import { setWatchBadge, useWatchBadge } from "@/lib/watch-badge";
import {
  checkWatchArtists,
  checkWatchTags,
  totalNew,
  type TagWatchCheckResult,
  type WatchCheckResult,
} from "@/lib/watch-check";
import {
  TAG_WATCH_LIMIT,
  TAG_WATCH_SOURCES,
  WATCH_DEFAULT_LIMIT,
  WATCH_MAX_LIMIT,
  WATCH_MIN_LIMIT,
  clampWatchLimit,
  tagWatchKey,
} from "@/lib/watch";
import { siteLabel } from "@/lib/sites";
import { cookiesFromSettings } from "@/lib/store";
import { fetchSource } from "@/lib/source";

export function WatchPage() {
  const watchArtists = useSettings((s) => s.watchArtists);
  const watchLimit = useSettings((s) => s.watchLimit);
  const watchTags = useSettings((s) => s.watchTags);
  const setWatchSeen = useSettings((s) => s.setWatchSeen);
  const toggleWatchArtist = useSettings((s) => s.toggleWatchArtist);
  const setWatchLimit = useSettings((s) => s.setWatchLimit);
  const setWatchTagSeen = useSettings((s) => s.setWatchTagSeen);
  const toggleWatchTag = useSettings((s) => s.toggleWatchTag);
  const setTab = useSettings((s) => s.setTab);
  const setBrowseQuery = useSettings((s) => s.setBrowseQuery);
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const navigate = useNavigate();
  const badge = useWatchBadge((s) => s.newCount);

  const [view, setView] = useState<"artists" | "tags">("artists");
  const [results, setResults] = useState<Record<string, WatchCheckResult>>({});
  const [tagResults, setTagResults] = useState<Record<string, TagWatchCheckResult>>({});
  const [checking, setChecking] = useState(false);
  const [addSource, setAddSource] = useState<(typeof TAG_WATCH_SOURCES)[number]>("pixiv");
  const [addTag, setAddTag] = useState("");

  const keyOf = (source: string, id: string) => `${source}:${id}`;

  async function checkAll() {
    if (checking) return;
    if (watchArtists.length === 0 && watchTags.length === 0) return;
    setChecking(true);
    try {
      // 画师与标签两路并发；红点 = 两路新数之和（角标是本机合计，见 watch-badge）
      const [artistList, tagList] = await Promise.all([
        watchArtists.length > 0
          ? checkWatchArtists(watchArtists, (source) => cookiesFromSettings(source))
          : Promise.resolve([] as WatchCheckResult[]),
        watchTags.length > 0
          ? checkWatchTags(watchTags, (source) => cookiesFromSettings(source))
          : Promise.resolve([] as TagWatchCheckResult[]),
      ]);
      const map: Record<string, WatchCheckResult> = {};
      for (const r of artistList) map[keyOf(r.source, r.id)] = r;
      setResults(map);
      const tagMap: Record<string, TagWatchCheckResult> = {};
      for (const r of tagList) tagMap[tagWatchKey(r.source, r.tag)] = r;
      setTagResults(tagMap);
      const unread = totalNew(artistList) + tagList.reduce((sum, r) => sum + (r.error ? 0 : r.newCount), 0);
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
    try {
    const existing = new Set(watchArtists.map((w) => keyOf(w.source, w.id)));
    const merged: { source: "pixiv"; id: string; name: string; avatar: string }[] = [];
    for (let page = 1; page <= Math.ceil(watchLimit / 24) + 1; page += 1) {
      const r = await fetchSource({ data: { op: "pixivMyFollowing", page, ...cookiesFromSettings("pixiv") } });
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
      if (toggleWatchArtist(a) === "added") added += 1;
    }
    toast.success(`已导入 ${added} 位画师`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导入失败");
    }
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
    for (const w of watchTags) {
      const r = tagResults[tagWatchKey(w.source, w.tag)];
      if (r?.newestId && w.lastSeenId !== r.newestId) {
        setWatchTagSeen(w.source, w.tag, r.newestId);
        n += 1;
      }
    }
    setWatchBadge(0);
    if (n > 0) toast.success(`已读 ${n} 项更新`);
  }

  function addTagSubscription() {
    const tag = addTag.trim();
    if (!tag) return;
    // 表单是纯「添加」：同词已订阅不动列表（toggleWatchTag 是切换语义，直接调会误删）
    if (useSettings.getState().watchTags.some((w) => tagWatchKey(w.source, w.tag) === tagWatchKey(addSource, tag))) {
      toast.info("该标签已订阅过");
      setAddTag("");
      return;
    }
    const res = toggleWatchTag(addSource, tag);
    if (res === "added") {
      setAddTag("");
      toast.success(`已订阅 ${siteLabel(addSource)}「${tag}」`);
    } else if (res === "full") {
      toast.error(`订阅已满 ${TAG_WATCH_LIMIT} 个`);
    }
  }

  function goBrowse(source: (typeof TAG_WATCH_SOURCES)[number], tag: string) {
    setTab(source);
    setBrowseQuery(tag, true);
    void navigate({ to: "/browse" });
  }

  const unreadTotal =
    Object.values(results).reduce((sum, r) => sum + (r.error ? 0 : r.newCount), 0) +
    Object.values(tagResults).reduce((sum, r) => sum + (r.error ? 0 : r.newCount), 0);
  const failing = [...Object.values(results), ...Object.values(tagResults)].filter((r) => r.error);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="font-display text-3xl tracking-tight md:text-4xl">追踪</h1>
        <p className="text-sm text-muted">
          {watchArtists.length}/{watchLimit} 位画师 · {watchTags.length}/{TAG_WATCH_LIMIT} 个标签
          {unreadTotal > 0 ? ` · ${unreadTotal} 张新作品` : ""}
          {" · 检查会拉取各条目最新一页并缓存到服务端（受缓存水位自动清理），订阅越多占用与流量越大。"}
        </p>
      </header>

      <ToggleGroup
        type="single"
        value={view}
        onValueChange={(v) => {
          if (v) setView(v as "artists" | "tags");
        }}
      >
        <ToggleGroupItem value="artists">
          <UserPlus className="size-4" />
          画师
        </ToggleGroupItem>
        <ToggleGroupItem value="tags">
          <Hash className="size-4" />
          标签
        </ToggleGroupItem>
      </ToggleGroup>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void checkAll()} disabled={checking || (watchArtists.length === 0 && watchTags.length === 0)}>
          <Bell className="size-4" />
          {checking ? "检查中…" : "检查更新"}
        </Button>
        {view === "artists" ? (
          <Button size="sm" variant="secondary" onClick={() => void importFollowing()}>
            <UserPlus className="size-4" />
            导入 Pixiv 关注
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={addSource}
              onChange={(e) => setAddSource(e.target.value as (typeof TAG_WATCH_SOURCES)[number])}
              aria-label="订阅站点"
              className="h-9 rounded-md bg-elevated px-2 text-sm text-fg"
            >
              {TAG_WATCH_SOURCES.map((site) => (
                <option key={site} value={site}>
                  {siteLabel(site)}
                </option>
              ))}
            </select>
            <Input
              value={addTag}
              onChange={(e) => setAddTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTagSubscription();
                }
              }}
              placeholder="标签（booru 空格写下划线）"
              className="h-9 w-52"
              aria-label="订阅标签"
            />
            <Button size="sm" variant="secondary" onClick={addTagSubscription}>
              <Hash className="size-4" />
              订阅
            </Button>
          </div>
        )}
        <Button size="sm" variant="ghost" onClick={markAllSeen} disabled={unreadTotal === 0}>
          全部标为已读
        </Button>
        {view === "artists" ? (
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
        ) : null}
      </div>

      {failing.length > 0 ? (
        <Alert>
          <AlertTitle>{failing.length} 项检查失败</AlertTitle>
          <AlertDescription>
            {failing
              .slice(0, 3)
              .map((r) => `${"id" in r ? r.id : r.tag}: ${r.error}`)
              .join("；")}
            {failing.length > 3 ? "…" : ""}（多为 Cookie 失效或标签无结果，去设置里更新 / 换个写法）
          </AlertDescription>
        </Alert>
      ) : null}

      {view === "artists" ? (
        watchArtists.length === 0 ? (
          <Alert>
            <AlertTitle>还没有追踪的画师</AlertTitle>
            <AlertDescription>去画师页点「追踪」，或用上面的按钮一键导入 Pixiv 关注。</AlertDescription>
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
                      <span className="grid size-10 place-items-center rounded-full bg-fg/10 text-xs">画</span>
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
        )
      ) : watchTags.length === 0 ? (
        <Alert>
          <AlertTitle>还没有订阅的标签</AlertTitle>
          <AlertDescription>
            上面选站点输入标签订阅，或在浏览页搜索时点「订阅」按钮订阅当前关键词。
          </AlertDescription>
        </Alert>
      ) : (
        <ul className="space-y-2">
          {watchTags.map((w) => {
            const key = tagWatchKey(w.source, w.tag);
            const r = tagResults[key];
            return (
              <li key={key} className="flex items-center gap-3 rounded-lg bg-elevated/50 p-3">
                <button
                  type="button"
                  onClick={() => goBrowse(w.source, w.tag)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="grid size-10 place-items-center rounded-full bg-fg/10">
                    <Hash className="size-4 text-muted" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{w.tag}</span>
                      <span className="shrink-0 rounded-full bg-fg/5 px-2 text-[10px] text-muted">{w.source}</span>
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
                </button>
                {r?.latestThumb && !r.error ? (
                  <img src={r.latestThumb} alt="" className="hidden h-12 w-12 shrink-0 rounded-md object-cover sm:block" />
                ) : null}
                {r && !r.error && r.newCount > 0 && r.newestId ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setWatchTagSeen(w.source, w.tag, r.newestId!);
                      setTagResults((prev) => ({ ...prev, [key]: { ...r, newCount: 0 } }));
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
                    toggleWatchTag(w.source, w.tag);
                    toast.success("已取消订阅");
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
