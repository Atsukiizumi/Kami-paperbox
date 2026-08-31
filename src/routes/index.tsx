import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Clipboard, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArtworkGrid, ArtworkGridSkeleton } from "@/components/artwork-card";
import { AiFilterSwitch } from "@/components/ai-filter-switch";
import { R18Switch } from "@/components/r18-switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseUserInput } from "@/lib/parse-input";
import {
  PIXIV_PERSONAL_FEEDS,
  PIXIV_RANK_MODES,
  formatRankDate,
  isPixivRankMode,
  type PixivFeed,
} from "@/lib/pixiv-feed";
import { fetchSource } from "@/lib/source";
import { cookiesFromSettings, useSettings } from "@/lib/store";
import { isBooru, siteLabel } from "@/lib/sites";
import { cn } from "@/lib/utils";
import type { WorkCard } from "@/lib/types";

export const Route = createFileRoute("/")({ component: Home });

type FanboxFeed = "home" | "supporting" | "creator";

function Home() {
  const navigate = useNavigate();
  const tab = useSettings((s) => s.tab);
  const setTab = useSettings((s) => s.setTab);
  const recents = useSettings((s) => s.recents);
  const addRecent = useSettings((s) => s.addRecent);
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const fanboxCookie = useSettings((s) => s.fanboxCookie);
  const safeMode = useSettings((s) => s.safeMode);
  const hideAi = useSettings((s) => s.hideAi);
  const [query, setQuery] = useState("");
  const [feed, setFeed] = useState<PixivFeed>("daily");
  const [page, setPage] = useState(1);
  const [batch, setBatch] = useState(0);
  const [searchWord, setSearchWord] = useState("");
  const [creatorId, setCreatorId] = useState("official");
  const [fanboxFeed, setFanboxFeed] = useState<FanboxFeed>("creator");
  const [booruFeed, setBooruFeed] = useState<"recent" | "popular">("recent");
  const browseQuery = useSettings((s) => s.browseQuery);
  const setBrowseQuery = useSettings((s) => s.setBrowseQuery);

  useEffect(() => {
    setSearchWord("");
    setQuery("");
    setPage(1);
  }, [tab]);

  useEffect(() => {
    if (!browseQuery) return;
    setSearchWord(browseQuery);
    setQuery(browseQuery);
    setPage(1);
    setBrowseQuery("");
  }, [browseQuery, setBrowseQuery]);

  useEffect(() => {
    if (pixivCookie && (feed === "daily" || feed === "recommend")) {
      setFeed("recommend");
    }
    if (!pixivCookie && (feed === "recommend" || feed === "following")) {
      setFeed("daily");
    }
  }, [pixivCookie]);

  useEffect(() => {
    if (fanboxCookie && fanboxFeed === "creator" && creatorId === "official") {
      setFanboxFeed("home");
    }
    if (!fanboxCookie && (fanboxFeed === "home" || fanboxFeed === "supporting")) {
      setFanboxFeed("creator");
    }
  }, [fanboxCookie]);

  const pixivQuery = useQuery({
    queryKey: ["home-pixiv", feed, page, batch, searchWord, safeMode, hideAi, pixivCookie],
    enabled: tab === "pixiv",
    queryFn: async () => {
      const creds = cookiesFromSettings();
      if (searchWord) {
        return fetchSource({ data: { op: "pixivSearch", word: searchWord, page, ...creds } });
      }
      if (feed === "recommend") {
        return fetchSource({ data: { op: "pixivRecommend", ...creds } });
      }
      if (feed === "following") {
        return fetchSource({ data: { op: "pixivFollowing", page, ...creds } });
      }
      if (!isPixivRankMode(feed)) {
        return fetchSource({ data: { op: "pixivRecommend", ...creds } });
      }
      return fetchSource({
        data: { op: "pixivRanking", mode: feed, page, ...creds },
      });
    },
  });

  const fanboxQuery = useQuery({
    queryKey: ["home-fanbox", fanboxFeed, creatorId, searchWord, page, safeMode, fanboxCookie],
    enabled: tab === "fanbox",
    queryFn: async () => {
      const creds = cookiesFromSettings();
      if (searchWord) {
        return fetchSource({ data: { op: "fanboxTagged", tag: searchWord, page, ...creds } });
      }
      if (fanboxFeed === "home") {
        return fetchSource({ data: { op: "fanboxHome", ...creds } });
      }
      if (fanboxFeed === "supporting") {
        return fetchSource({ data: { op: "fanboxSupporting", ...creds } });
      }
      return fetchSource({
        data: { op: "fanboxCreator", id: creatorId, ...creds },
      });
    },
  });

  const booruQuery = useQuery({
    queryKey: ["home-booru", tab, booruFeed, searchWord, page, safeMode],
    enabled: isBooru(tab),
    queryFn: async () => {
      if (!isBooru(tab)) throw new Error("not booru");
      return fetchSource({
        data: {
          op: "booruList",
          site: tab,
          feed: searchWord ? "recent" : booruFeed,
          tags: searchWord || undefined,
          page,
          ...cookiesFromSettings(),
        },
      });
    },
  });

  function goFromInput(raw: string) {
    const parsed = parseUserInput(raw, tab);
    if (parsed.kind === "query" && !parsed.word) return;
    addRecent(raw.trim());
    switch (parsed.kind) {
      case "pixiv-illust":
        void navigate({ to: "/work/$source/$id", params: { source: "pixiv", id: parsed.id } });
        return;
      case "pixiv-user":
        void navigate({ to: "/user/$id", params: { id: parsed.id } });
        return;
      case "fanbox-post":
        void navigate({ to: "/work/$source/$id", params: { source: "fanbox", id: parsed.id } });
        return;
      case "fanbox-creator":
        setTab("fanbox");
        setFanboxFeed("creator");
        setCreatorId(parsed.id);
        setSearchWord("");
        return;
      case "fanbox-tag":
        setTab("fanbox");
        setSearchWord(parsed.word);
        setPage(1);
        return;
      case "pixiv-tag":
        setTab("pixiv");
        setSearchWord(parsed.word);
        setPage(1);
        return;
      case "booru-post":
        setTab(parsed.site);
        void navigate({
          to: "/work/$source/$id",
          params: { source: parsed.site, id: parsed.id },
        });
        return;
      case "booru-tag":
        setTab(parsed.site);
        setSearchWord(parsed.word);
        setBooruFeed("recent");
        setPage(1);
        return;
      case "query":
        if (tab === "fanbox") {
          setSearchWord(parsed.word);
          setPage(1);
        } else {
          setSearchWord(parsed.word);
          setPage(1);
        }
        return;
    }
  }

  async function pasteClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toast.error("剪贴板是空的");
        return;
      }
      setQuery(text.trim());
      goFromInput(text);
    } catch {
      toast.error("无法读取剪贴板，请手动粘贴");
    }
  }

  function choosePixivFeed(next: PixivFeed) {
    const needsLogin = next === "recommend" || next === "following" || rankingNeedsLogin(next);
    if (needsLogin && !pixivCookie) {
      toast.error("先在设置里添加 Pixiv 账号");
      return;
    }
    const nsfw = isPixivRankMode(next) && PIXIV_RANK_MODES.find((m) => m.id === next)?.nsfw;
    if (nsfw && safeMode) {
      toast.error("打开 R-18 后才能看该榜");
      return;
    }
    setFeed(next);
    setSearchWord("");
    setPage(1);
  }

  const pixivItems: WorkCard[] =
    pixivQuery.data &&
    (pixivQuery.data.op === "pixivRanking" ||
      pixivQuery.data.op === "pixivSearch" ||
      pixivQuery.data.op === "pixivRecommend" ||
      pixivQuery.data.op === "pixivFollowing")
      ? pixivQuery.data.items
      : [];
  const rankingDate =
    pixivQuery.data && pixivQuery.data.op === "pixivRanking" ? pixivQuery.data.date : "";
  const fanboxItems: WorkCard[] =
    fanboxQuery.data &&
    (fanboxQuery.data.op === "fanboxCreator" ||
      fanboxQuery.data.op === "fanboxHome" ||
      fanboxQuery.data.op === "fanboxSupporting" ||
      fanboxQuery.data.op === "fanboxTagged")
      ? fanboxQuery.data.items
      : [];
  const fanboxProfile =
    fanboxQuery.data && fanboxQuery.data.op === "fanboxCreator" ? fanboxQuery.data.profile : null;
  const booruItems: WorkCard[] =
    booruQuery.data && booruQuery.data.op === "booruList" ? booruQuery.data.items : [];
  const items = tab === "pixiv" ? pixivItems : tab === "fanbox" ? fanboxItems : booruItems;
  const activeQuery = tab === "pixiv" ? pixivQuery : tab === "fanbox" ? fanboxQuery : booruQuery;
  const loading = activeQuery.isFetching;
  const error =
    activeQuery.error instanceof Error
      ? activeQuery.error.message
      : activeQuery.error
        ? "加载失败"
        : null;

  const showPixivPager = Boolean(searchWord) || feed === "following" || isPixivRankMode(feed);
  const showFanboxPager = tab === "fanbox" && Boolean(searchWord);
  const showBooruPager =
    isBooru(tab) && (Boolean(searchWord) || booruFeed === "recent" || tab === "danbooru");
  const rankModes = PIXIV_RANK_MODES.filter((m) => !m.nsfw || !safeMode);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="font-display text-3xl leading-tight tracking-tight text-fg md:text-4xl">
            {siteLabel(tab)}
          </h1>
          <p className="max-w-lg text-sm text-muted">
            {tab === "pixiv"
              ? "标签搜索、打开作品。登录后可收藏、红心和关注。"
              : tab === "fanbox"
                ? "搜标签或打开创作者。"
                : `用标签搜索 ${siteLabel(tab)}，点卡片看大图。`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 pt-1">
          {tab === "pixiv" ? <AiFilterSwitch /> : null}
          <R18Switch />
        </div>
      </header>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          goFromInput(query);
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              tab === "pixiv"
                ? "搜索标签，或粘贴作品 / 画师链接"
                : tab === "fanbox"
                  ? "搜索标签，或输入创作者 ID / 链接"
                  : "搜索标签，或粘贴作品链接"
            }
            className="pl-10"
            enterKeyHint="search"
          />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => void pasteClipboard()}>
            <Clipboard className="size-4" />
            粘贴
          </Button>
          <Button type="submit">打开</Button>
        </div>
      </form>

      {recents.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {recents.map((item) => (
            <button
              key={item}
              type="button"
              className="max-w-full truncate rounded-full bg-elevated px-3 py-1 text-xs text-muted hover:text-fg"
              onClick={() => goFromInput(item)}
            >
              {item}
            </button>
          ))}
        </div>
      ) : null}

      {tab === "pixiv" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {PIXIV_PERSONAL_FEEDS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => choosePixivFeed(item.id)}
                className={cn(
                  "h-9 rounded-full px-3.5 text-sm transition-colors",
                  !searchWord && feed === item.id
                    ? "bg-accent text-accent-fg"
                    : "bg-elevated text-muted hover:text-fg",
                  !pixivCookie && "opacity-70",
                )}
              >
                {item.label}
              </button>
            ))}
            {searchWord ? (
              <button
                type="button"
                className="h-9 rounded-full bg-accent px-3.5 text-sm text-accent-fg"
                onClick={() => {
                  setSearchWord("");
                  setPage(1);
                }}
              >
                搜索「{searchWord}」×
              </button>
            ) : null}
            {rankingDate && !searchWord && isPixivRankMode(feed) ? (
              <span className="ml-auto text-xs tabular-nums text-subtle">
                {formatRankDate(rankingDate)}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {rankModes.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => choosePixivFeed(r.id)}
                className={cn(
                  "h-9 rounded-full px-3.5 text-sm transition-colors",
                  !searchWord && feed === r.id
                    ? "bg-accent text-accent-fg"
                    : "bg-elevated text-muted hover:text-fg",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      ) : tab === "fanbox" ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (!fanboxCookie) {
                toast.error("先在设置里添加 FANBOX 账号");
                return;
              }
              setFanboxFeed("home");
              setSearchWord("");
            }}
            className={cn(
              "h-9 rounded-full px-3.5 text-sm",
              fanboxFeed === "home" ? "bg-accent text-accent-fg" : "bg-elevated text-muted hover:text-fg",
            )}
          >
            动态
          </button>
          <button
            type="button"
            onClick={() => {
              if (!fanboxCookie) {
                toast.error("先在设置里添加 FANBOX 账号");
                return;
              }
              setFanboxFeed("supporting");
              setSearchWord("");
            }}
            className={cn(
              "h-9 rounded-full px-3.5 text-sm",
              fanboxFeed === "supporting"
                ? "bg-accent text-accent-fg"
                : "bg-elevated text-muted hover:text-fg",
            )}
          >
            已支持
          </button>
          <button
            type="button"
            onClick={() => {
              setFanboxFeed("creator");
              setSearchWord("");
            }}
            className={cn(
              "h-9 rounded-full px-3.5 text-sm",
              fanboxFeed === "creator" ? "bg-accent text-accent-fg" : "bg-elevated text-muted hover:text-fg",
            )}
          >
            创作者
          </button>
          {searchWord ? (
            <button
              type="button"
              className="h-9 rounded-full bg-accent px-3.5 text-sm text-accent-fg"
              onClick={() => {
                setSearchWord("");
                setPage(1);
              }}
            >
              标签「{searchWord}」×
            </button>
          ) : null}
          {fanboxFeed === "creator" ? (
            <>
              <code className="rounded-md bg-elevated px-2 py-1 text-sm text-fg">{creatorId}</code>
              {fanboxProfile ? <span className="text-sm text-muted">{fanboxProfile.name}</span> : null}
            </>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {(["recent", "popular"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setBooruFeed(id);
                setSearchWord("");
                setPage(1);
              }}
              className={cn(
                "h-9 rounded-full px-3.5 text-sm",
                !searchWord && booruFeed === id
                  ? "bg-accent text-accent-fg"
                  : "bg-elevated text-muted hover:text-fg",
              )}
            >
              {id === "recent" ? "最新" : "热门"}
            </button>
          ))}
          {searchWord ? (
            <button
              type="button"
              className="h-9 rounded-full bg-accent px-3.5 text-sm text-accent-fg"
              onClick={() => {
                setSearchWord("");
                setPage(1);
              }}
            >
              标签「{searchWord}」×
            </button>
          ) : null}
        </div>
      )}

      {error ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-6 text-sm text-muted">
          <p className="text-fg">{error.includes("登录") ? error : "暂时无法连接到源站。"}</p>
          {error.includes("登录") ? (
            <Button className="mt-4" variant="secondary" asChild>
              <Link to="/settings">去设置账号</Link>
            </Button>
          ) : (
            <>
              <p className="mt-1">{error}</p>
              <Button className="mt-4" variant="secondary" onClick={() => void activeQuery.refetch()}>
                重试
              </Button>
            </>
          )}
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <ArtworkGridSkeleton count={8} />
      ) : (
        <ArtworkGrid
          items={items}
          empty={
            tab === "pixiv" && hideAi
              ? "已过滤 AI 作画。关闭右上角「过滤 AI」可显示。"
              : isBooru(tab) && safeMode
                ? "全年龄结果比较少。打开右上角 R-18 可以看到更多。"
                : undefined
          }
        />
      )}

      {tab === "pixiv" && feed === "recommend" && !searchWord && pixivItems.length > 0 ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            disabled={loading}
            onClick={() => {
              setBatch((n) => n + 1);
            }}
          >
            换一批
          </Button>
        </div>
      ) : null}

      {tab === "pixiv" && showPixivPager && pixivItems.length > 0 ? (
        <div className="flex justify-center gap-2 pt-2">
          <Button
            variant="secondary"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </Button>
          <span className="flex h-11 items-center px-2 text-sm tabular-nums text-muted">{page}</span>
          <Button variant="secondary" disabled={loading} onClick={() => setPage((p) => p + 1)}>
            下一页
          </Button>
        </div>
      ) : null}

      {showBooruPager && booruItems.length > 0 ? (
        <div className="flex justify-center gap-2 pt-2">
          <Button
            variant="secondary"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </Button>
          <span className="flex h-11 items-center px-2 text-sm tabular-nums text-muted">{page}</span>
          <Button variant="secondary" disabled={loading} onClick={() => setPage((p) => p + 1)}>
            下一页
          </Button>
        </div>
      ) : null}

      {showFanboxPager && fanboxItems.length > 0 ? (
        <div className="flex justify-center gap-2 pt-2">
          <Button
            variant="secondary"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </Button>
          <span className="flex h-11 items-center px-2 text-sm tabular-nums text-muted">{page}</span>
          <Button variant="secondary" disabled={loading} onClick={() => setPage((p) => p + 1)}>
            下一页
          </Button>
        </div>
      ) : null}

      {tab === "fanbox" && fanboxProfile && fanboxFeed === "creator" && !searchWord ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            onClick={() => void navigate({ to: "/creator/$id", params: { id: fanboxProfile.id } })}
          >
            打开创作者主页
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function rankingNeedsLogin(feed: PixivFeed): boolean {
  if (!isPixivRankMode(feed)) return false;
  return Boolean(PIXIV_RANK_MODES.find((m) => m.id === feed)?.login);
}
