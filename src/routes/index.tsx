import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Clipboard, Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArtworkGrid, ArtworkGridSkeleton } from "@/components/artwork-card";
import { InfiniteSentinel } from "@/components/infinite-sentinel";
import { SavedTagBar } from "@/components/saved-tags";
import { SearchSuggest } from "@/components/search-suggest";
import { AiFilterSwitch } from "@/components/ai-filter-switch";
import { R18Switch } from "@/components/r18-switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { isPixivLoggedInSession, fanboxSessionFrom } from "@/lib/browser-login";
import { isBooru, siteLabel } from "@/lib/sites";
import { canonicalTag, tagPlaceholder } from "@/lib/site-tags";
import type { FanboxCursor, FetchOk, WorkCard } from "@/lib/types";

export const Route = createFileRoute("/")({ component: Home });

type FanboxFeed = "home" | "supporting" | "creator";

function Home() {
  const navigate = useNavigate();
  const tab = useSettings((s) => s.tab);
  const setTab = useSettings((s) => s.setTab);
  const recents = useSettings((s) => s.recents);
  const addRecent = useSettings((s) => s.addRecent);
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const fanboxCookie = useSettings((s) => fanboxSessionFrom(s.fanboxCookie, s.pixivCookie));
  const safeMode = useSettings((s) => s.safeMode);
  const hideAi = useSettings((s) => s.hideAi);
  const [query, setQuery] = useState("");
  const [feed, setFeed] = useState<PixivFeed>("daily");
  const [searchWord, setSearchWord] = useState("");
  const [searchExact, setSearchExact] = useState(false);
  const [creatorId, setCreatorId] = useState("official");
  const [fanboxFeed, setFanboxFeed] = useState<FanboxFeed>("creator");
  const [booruFeed, setBooruFeed] = useState<"recent" | "popular">("recent");
  const browseQuery = useSettings((s) => s.browseQuery);
  const browseExact = useSettings((s) => s.browseExact);
  const setBrowseQuery = useSettings((s) => s.setBrowseQuery);
  const savedTags = useSettings((s) => s.savedTags[tab] ?? []);
  const toggleSavedTag = useSettings((s) => s.toggleSavedTag);

  useEffect(() => {
    setSearchWord("");
    setQuery("");
    setSearchExact(false);
  }, [tab]);

  useEffect(() => {
    if (!browseQuery) return;
    const word = canonicalTag(tab, browseQuery) || browseQuery.trim();
    setSearchWord(word);
    setQuery(word);
    setSearchExact(browseExact);
    setBrowseQuery("");
  }, [browseQuery, browseExact, setBrowseQuery, tab]);

  const loggedIn = isPixivLoggedInSession(pixivCookie);
  useEffect(() => {
    if (loggedIn && (feed === "daily" || feed === "recommend")) {
      setFeed("recommend");
    }
    if (!loggedIn && (feed === "recommend" || feed === "following")) {
      setFeed("daily");
    }
  }, [loggedIn]);

  useEffect(() => {
    if (fanboxCookie && fanboxFeed === "creator" && creatorId === "official") {
      setFanboxFeed("home");
    }
    if (!fanboxCookie && (fanboxFeed === "home" || fanboxFeed === "supporting")) {
      setFanboxFeed("creator");
    }
  }, [fanboxCookie]);

  const pixivQuery = useInfiniteQuery({
    queryKey: ["home-pixiv", feed, searchWord, searchExact, safeMode, hideAi, pixivCookie],
    enabled: tab === "pixiv",
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const creds = cookiesFromSettings();
      if (searchWord) {
        return fetchSource({
          data: { op: "pixivSearch", word: searchWord, page: pageParam, exact: searchExact, ...creds },
        });
      }
      if (feed === "recommend") {
        return fetchSource({ data: { op: "pixivRecommend", ...creds } });
      }
      if (feed === "following") {
        return fetchSource({ data: { op: "pixivFollowing", page: pageParam, ...creds } });
      }
      if (!isPixivRankMode(feed)) {
        return fetchSource({ data: { op: "pixivRecommend", ...creds } });
      }
      return fetchSource({
        data: { op: "pixivRanking", mode: feed, page: pageParam, ...creds },
      });
    },
    getNextPageParam: (last, pages) => {
      if (last.op === "pixivRecommend") {
        return last.items.length > 0 && pages.length < 8 ? pages.length + 1 : undefined;
      }
      return "nextPage" in last ? (last.nextPage ?? undefined) : undefined;
    },
  });

  const fanboxQuery = useInfiniteQuery({
    queryKey: ["home-fanbox", fanboxFeed, creatorId, searchWord, safeMode, fanboxCookie],
    enabled: tab === "fanbox",
    initialPageParam: (searchWord ? 1 : undefined) as number | FanboxCursor | undefined,
    queryFn: async ({ pageParam }) => {
      const creds = cookiesFromSettings();
      if (searchWord) {
        const pageNo = typeof pageParam === "number" ? pageParam : 1;
        return fetchSource({ data: { op: "fanboxTagged", tag: searchWord, page: pageNo, ...creds } });
      }
      const cursor = pageParam && typeof pageParam === "object" ? pageParam : undefined;
      if (fanboxFeed === "home") {
        return fetchSource({ data: { op: "fanboxHome", cursor, ...creds } });
      }
      if (fanboxFeed === "supporting") {
        return fetchSource({ data: { op: "fanboxSupporting", cursor, ...creds } });
      }
      return fetchSource({
        data: { op: "fanboxCreator", id: creatorId, cursor, ...creds },
      });
    },
    getNextPageParam: (last) => {
      if (last.op === "fanboxTagged") return last.nextPage ?? undefined;
      if ("cursor" in last) return last.cursor ?? undefined;
      return undefined;
    },
  });

  const booruQuery = useInfiniteQuery({
    queryKey: ["home-booru", tab, booruFeed, searchWord, safeMode],
    enabled: isBooru(tab),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      if (!isBooru(tab)) throw new Error("not booru");
      return fetchSource({
        data: {
          op: "booruList",
          site: tab,
          feed: searchWord ? "recent" : booruFeed,
          tags: searchWord || undefined,
          page: pageParam,
          ...cookiesFromSettings(),
        },
      });
    },
    getNextPageParam: (last) => (last.op === "booruList" ? (last.nextPage ?? undefined) : undefined),
  });

  function runTagSearch(source: typeof tab, word: string, exact: boolean) {
    const next = canonicalTag(source, word) || word.trim();
    if (!next) return;
    if (source !== tab) setTab(source);
    setSearchWord(next);
    setQuery(next);
    setSearchExact(exact);
    if (isBooru(source)) setBooruFeed("recent");
  }

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
        runTagSearch("fanbox", parsed.word, true);
        return;
      case "pixiv-tag":
        runTagSearch("pixiv", parsed.word, true);
        return;
      case "booru-post":
        setTab(parsed.site);
        void navigate({
          to: "/work/$source/$id",
          params: { source: parsed.site, id: parsed.id },
        });
        return;
      case "booru-tag":
        runTagSearch(parsed.site, parsed.word, true);
        return;
      case "query":
        runTagSearch(tab, parsed.word, false);
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
    if (needsLogin && !loggedIn) {
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
    setSearchExact(false);
  }

  const pixivItems = collectWorks(pixivQuery.data?.pages);
  const rankingDate =
    pixivQuery.data?.pages[0] && pixivQuery.data.pages[0].op === "pixivRanking"
      ? pixivQuery.data.pages[0].date
      : "";
  const fanboxItems: WorkCard[] =
    fanboxQuery.data?.pages.flatMap((p) =>
      p.op === "fanboxCreator" ||
      p.op === "fanboxHome" ||
      p.op === "fanboxSupporting" ||
      p.op === "fanboxTagged"
        ? p.items
        : [],
    ) ?? [];
  const fanboxCreatorPage = fanboxQuery.data?.pages.find((p) => p.op === "fanboxCreator");
  const fanboxProfile = fanboxCreatorPage && fanboxCreatorPage.op === "fanboxCreator" ? fanboxCreatorPage.profile : null;
  const booruItems = collectWorks(booruQuery.data?.pages);
  const items = tab === "pixiv" ? pixivItems : tab === "fanbox" ? fanboxItems : booruItems;
  const activeQuery = tab === "pixiv" ? pixivQuery : tab === "fanbox" ? fanboxQuery : booruQuery;
  const loading = activeQuery.isLoading || (activeQuery.isFetching && items.length === 0 && !activeQuery.isFetchingNextPage);
  const error =
    activeQuery.error instanceof Error
      ? activeQuery.error.message
      : activeQuery.error
        ? "加载失败"
        : null;
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
              ? "标签搜索、打开作品。登录后可收藏、红心和关注。点标签是精确匹配。"
              : tab === "fanbox"
                ? "一次搜索一个标签，或打开创作者。"
                : `用标签搜索 ${siteLabel(tab)}。空格表示并且，标签里的空格写成下划线。`}
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
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-subtle" />
          <Input
            id="kami-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tagPlaceholder(tab)}
            className="pl-10"
            enterKeyHint="search"
            autoComplete="off"
            aria-autocomplete="list"
          />
          <SearchSuggest
            source={tab}
            query={query}
            saved={[...savedTags, ...recents]}
            onPick={(word) => {
              setQuery(word);
              goFromInput(word);
            }}
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

      <SavedTagBar
        source={tab}
        tags={savedTags}
        active={searchWord}
        current={searchWord}
        onSearch={(tag) => runTagSearch(tab, tag, true)}
        onToggle={(tag) => toggleSavedTag(tab, tag)}
        onSaveCurrent={() => toggleSavedTag(tab, searchWord)}
      />

      {recents.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {recents.map((item) => (
            <Button
              key={item}
              type="button"
              variant="secondary"
              size="sm"
              className="max-w-full truncate rounded-full"
              onClick={() => goFromInput(item)}
            >
              {item}
            </Button>
          ))}
        </div>
      ) : null}

      {tab === "pixiv" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              value={!searchWord ? feed : ""}
              onValueChange={(v) => {
                if (v) choosePixivFeed(v as PixivFeed);
              }}
            >
              {PIXIV_PERSONAL_FEEDS.map((item) => (
                <ToggleGroupItem key={item.id} value={item.id} className={!loggedIn ? "opacity-70" : undefined}>
                  {item.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {searchWord ? (
              <Button
                type="button"
                size="sm"
                className="rounded-full"
                onClick={() => {
                  setSearchWord("");
                }}
              >
                搜索「{searchWord}」×
              </Button>
            ) : null}
            {rankingDate && !searchWord && isPixivRankMode(feed) ? (
              <span className="ml-auto text-xs tabular-nums text-subtle">
                {formatRankDate(rankingDate)}
              </span>
            ) : null}
          </div>
          <ToggleGroup
            type="single"
            value={!searchWord && isPixivRankMode(feed) ? feed : ""}
            onValueChange={(v) => {
              if (v) choosePixivFeed(v as PixivFeed);
            }}
          >
            {rankModes.map((r) => (
              <ToggleGroupItem key={r.id} value={r.id}>
                {r.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      ) : tab === "fanbox" ? (
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            value={!searchWord ? fanboxFeed : ""}
            onValueChange={(v) => {
              if (!v) return;
              if (v !== "creator" && !fanboxCookie) {
                toast.error("先在设置里添加 FANBOX 账号");
                return;
              }
              setFanboxFeed(v as FanboxFeed);
              setSearchWord("");
            }}
          >
            <ToggleGroupItem value="home">动态</ToggleGroupItem>
            <ToggleGroupItem value="supporting">已支持</ToggleGroupItem>
            <ToggleGroupItem value="creator">创作者</ToggleGroupItem>
          </ToggleGroup>
          {searchWord ? (
            <Button
              type="button"
              size="sm"
              className="rounded-full"
              onClick={() => {
                setSearchWord("");
              }}
            >
              标签「{searchWord}」×
            </Button>
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
          <ToggleGroup
            type="single"
            value={!searchWord ? booruFeed : ""}
            onValueChange={(v) => {
              if (!v) return;
              setBooruFeed(v as "recent" | "popular");
              setSearchWord("");
            }}
          >
            <ToggleGroupItem value="recent">最新</ToggleGroupItem>
            <ToggleGroupItem value="popular">热门</ToggleGroupItem>
          </ToggleGroup>
          {searchWord ? (
            <Button
              type="button"
              size="sm"
              className="rounded-full"
              onClick={() => {
                setSearchWord("");
              }}
            >
              标签「{searchWord}」×
            </Button>
          ) : null}
        </div>
      )}

      {error ? (
        <Alert>
          <AlertTitle>{error.includes("登录") ? error : "暂时无法连接到源站。"}</AlertTitle>
          {error.includes("登录") ? (
            <AlertDescription>
              <Button className="mt-3" variant="secondary" asChild>
                <Link to="/settings">去设置账号</Link>
              </Button>
            </AlertDescription>
          ) : (
            <AlertDescription>
              {error}
              <Button className="mt-3" variant="secondary" onClick={() => void activeQuery.refetch()}>
                重试
              </Button>
            </AlertDescription>
          )}
        </Alert>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 text-xs text-subtle">
          <Loader2 className="size-3.5 animate-spin" />
          正在加载作品…
        </p>
      ) : null}

      {loading && items.length === 0 ? (
        <ArtworkGridSkeleton count={10} />
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

      <InfiniteSentinel
        disabled={!activeQuery.hasNextPage || items.length === 0}
        onVisible={() => {
          if (activeQuery.hasNextPage && !activeQuery.isFetchingNextPage) {
            void activeQuery.fetchNextPage();
          }
        }}
      />

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

function collectWorks(pages: FetchOk[] | undefined): WorkCard[] {
  const seen = new Set<string>();
  const out: WorkCard[] = [];
  for (const page of pages ?? []) {
    if (!("items" in page) || page.op === "tagSuggest") continue;
    for (const work of page.items) {
      const key = `${work.source}-${work.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(work);
    }
  }
  return out;
}
