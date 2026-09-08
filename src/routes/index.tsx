"use client";

import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Link, useNavigate } from "@/lib/kami-link";
import { Clipboard, RefreshCw, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArtworkGrid, ArtworkGridSkeleton } from "@/components/artwork-card";
import { BrowsePager, BROWSE_PAGE_SIZE } from "@/components/browse-pager";
import { PaperMark } from "@/components/paper-mark";
import { SavedTagBar } from "@/components/saved-tags";
import { SearchSuggest } from "@/components/search-suggest";
import { PixivSearchFilter } from "@/components/pixiv-search-filter";
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
import { cookiesFromSettings, useSettings, useSettingsHydrated } from "@/lib/store";
import { cn } from "@/lib/utils";
import { isPixivLoggedInSession, fanboxSessionFrom } from "@/lib/browser-login";
import { BOORU_FEEDS, isBooruPeriodFeed, parseBoardDate, type BooruFeed } from "@/lib/booru";
import { pixivRankingDateParam, rankingPeriodOf, rememberRanking } from "@/lib/ranking-archive";
import { isBooru, siteLabel } from "@/lib/sites";
import { canonicalTag, tagPlaceholder } from "@/lib/site-tags";
import type { FanboxCursor, FetchOk, WorkCard } from "@/lib/types";
import {
  DEFAULT_PIXIV_SEARCH,
  PIXIV_SEARCH_ORDERS,
  scopeFromExact,
  type PixivSearchFilter as PixivSearchFilterValue,
} from "@/lib/pixiv-search";

type FanboxFeed = "home" | "supporting" | "creator";

export function Home() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tab = useSettings((s) => s.tab);
  const setTab = useSettings((s) => s.setTab);
  const recents = useSettings((s) => s.recents);
  const addRecent = useSettings((s) => s.addRecent);
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const accounts = useSettings((s) => s.accounts);
  const activeAccountId = useSettings((s) => s.activeAccountId);
  const setSafeMode = useSettings((s) => s.setSafeMode);
  const fanboxCookie = useSettings((s) => fanboxSessionFrom(s.fanboxCookie, s.pixivCookie));
  const safeMode = useSettings((s) => s.safeMode);
  const hideAi = useSettings((s) => s.hideAi);
  const settingsReady = useSettingsHydrated();
  const forceFresh = useRef(false);
  const refreshAt = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [feedPick, setFeed] = useState<PixivFeed | null>(null);
  const [searchWord, setSearchWord] = useState("");
  const [searchFilter, setSearchFilter] = useState<PixivSearchFilterValue>(DEFAULT_PIXIV_SEARCH);
  const [creatorId, setCreatorId] = useState("official");
  const [fanboxPick, setFanboxFeed] = useState<FanboxFeed | null>(null);
  const [booruFeed, setBooruFeed] = useState<BooruFeed>("recent");
  const [boardDate, setBoardDate] = useState(() => parseBoardDate().iso);
  const [listPage, setListPage] = useState(1);
  const [listTab, setListTab] = useState(tab);
  if (listTab !== tab) {
    setListTab(tab);
    setListPage(1);
  }
  const browseQuery = useSettings((s) => s.browseQuery);
  const browseExact = useSettings((s) => s.browseExact);
  const setBrowseQuery = useSettings((s) => s.setBrowseQuery);
  const savedTags = useSettings((s) => s.savedTags[tab] ?? []);
  const toggleSavedTag = useSettings((s) => s.toggleSavedTag);

  useEffect(() => {
    setSearchWord("");
    setQuery("");
    setSearchFilter(DEFAULT_PIXIV_SEARCH);
    setListPage(1);
  }, [tab]);

  useEffect(() => {
    if (!browseQuery) return;
    const word = canonicalTag(tab, browseQuery) || browseQuery.trim();
    setSearchWord(word);
    setQuery(word);
    setSearchFilter((cur) => ({ ...cur, scope: scopeFromExact(browseExact) }));
    setBrowseQuery("");
    setListPage(1);
  }, [browseQuery, browseExact, setBrowseQuery, tab]);

  const loggedIn = isPixivLoggedInSession(pixivCookie) || Boolean(accounts.find((a) => a.id === activeAccountId)?.pixivProfile?.id);
  const feed: PixivFeed = feedPick ?? (loggedIn ? "recommend" : "daily");
  const fanboxFeed: FanboxFeed = fanboxPick ?? (fanboxCookie ? "home" : "creator");
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

  function sourceCreds() {
    const creds = cookiesFromSettings();
    return forceFresh.current ? { ...creds, fresh: true } : creds;
  }

  const pixivQuery = useInfiniteQuery({
    queryKey: ["home-pixiv", feed, searchWord, searchFilter, safeMode, hideAi, pixivCookie, boardDate],
    enabled: settingsReady && tab === "pixiv",
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const creds = sourceCreds();
      if (searchWord) {
        return fetchSource({
          data: { op: "pixivSearch", word: searchWord, page: pageParam, filter: searchFilter, ...creds },
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
        data: {
          op: "pixivRanking",
          mode: feed,
          page: pageParam,
          date: pixivRankingDateParam(boardDate),
          ...creds,
        },
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
    enabled: settingsReady && tab === "fanbox",
    initialPageParam: (searchWord ? 1 : undefined) as number | FanboxCursor | undefined,
    queryFn: async ({ pageParam }) => {
      const creds = sourceCreds();
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
    queryKey: ["home-booru", tab, booruFeed, searchWord, safeMode, boardDate],
    enabled: settingsReady && isBooru(tab),
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
          date: !searchWord && isBooruPeriodFeed(booruFeed) ? boardDate : undefined,
          ...sourceCreds(),
        },
      });
    },
    getNextPageParam: (last) => (last.op === "booruList" ? (last.nextPage ?? undefined) : undefined),
  });

  function runTagSearch(source: typeof tab, word: string, exact: boolean) {
    const next = canonicalTag(source, word) || word.trim();
    if (!next) {
      setSearchWord("");
      setQuery("");
      return;
    }
    if (source !== tab) setTab(source);
    setSearchWord(next);
    setQuery(next);
    setSearchFilter((cur) => ({ ...cur, scope: scopeFromExact(exact) }));
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
      case "booru-pool":
        setTab(parsed.site);
        void navigate({
          to: "/pool/$site/$id",
          params: { site: parsed.site, id: parsed.id },
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
    const nsfw = isPixivRankMode(next) && PIXIV_RANK_MODES.find((m) => m.id === next)?.nsfw;
    if (nsfw && safeMode) setSafeMode(false);
    const needsLogin = next === "recommend" || next === "following" || rankingNeedsLogin(next);
    if (needsLogin && !loggedIn) {
      toast.error(
        accounts.length
          ? "当前账号的 Pixiv 会话无效，请到设置重新登录"
          : "先在设置里添加 Pixiv 账号",
      );
      return;
    }
    setFeed(next);
    setSearchWord("");
    setSearchFilter((cur) => ({ ...cur, scope: "s_tag" }));
    setListPage(1);
  }

  const pixivItems = collectWorks(pixivQuery.data?.pages, "pixiv");
  const rankingDate =
    pixivQuery.data?.pages[0] && pixivQuery.data.pages[0].op === "pixivRanking"
      ? pixivQuery.data.pages[0].date
      : "";

  useEffect(() => {
    if (!isBooru(tab) || searchWord || !isBooruPeriodFeed(booruFeed)) return;
    const page = booruQuery.data?.pages[0];
    if (!page || page.op !== "booruList" || page.items.length === 0) return;
    void rememberRanking({ site: tab, period: booruFeed, date: boardDate, items: page.items });
  }, [tab, booruFeed, searchWord, booruQuery.data, boardDate]);
  const fanboxItems: WorkCard[] =
    fanboxQuery.data?.pages.flatMap((p) =>
      p.op === "fanboxCreator" ||
      p.op === "fanboxHome" ||
      p.op === "fanboxSupporting" ||
      p.op === "fanboxTagged"
        ? p.items.filter((work) => work.source === "fanbox")
        : [],
    ) ?? [];
  const fanboxCreatorPage = fanboxQuery.data?.pages.find((p) => p.op === "fanboxCreator");
  const fanboxProfile = fanboxCreatorPage && fanboxCreatorPage.op === "fanboxCreator" ? fanboxCreatorPage.profile : null;
  const booruItems = collectWorks(booruQuery.data?.pages, isBooru(tab) ? tab : undefined);
  const pooled = tab === "pixiv" ? pixivItems : tab === "fanbox" ? fanboxItems : booruItems;
  const activeQuery = tab === "pixiv" ? pixivQuery : tab === "fanbox" ? fanboxQuery : booruQuery;
  const pageStart = (listPage - 1) * BROWSE_PAGE_SIZE;
  const items = pooled.slice(pageStart, pageStart + BROWSE_PAGE_SIZE);
  const hasPrevPage = listPage > 1;
  const hasNextPage = pooled.length > pageStart + BROWSE_PAGE_SIZE || Boolean(activeQuery.hasNextPage);
  const loading =
    !settingsReady ||
    refreshing ||
    activeQuery.isLoading ||
    (activeQuery.isFetching && items.length === 0 && !activeQuery.isFetchingNextPage);

  useEffect(() => {
    setListPage(1);
  }, [feed, searchWord, searchFilter, fanboxFeed, creatorId, booruFeed, safeMode, hideAi]);

  useEffect(() => {
    if (pooled.length >= listPage * BROWSE_PAGE_SIZE) return;
    if (!activeQuery.hasNextPage || activeQuery.isFetchingNextPage) return;
    void activeQuery.fetchNextPage();
  }, [listPage, pooled.length, activeQuery.hasNextPage, activeQuery.isFetchingNextPage, tab]);

  useEffect(() => {
    if (!refreshing) return;
    if (activeQuery.isFetching || activeQuery.isFetchingNextPage) return;
    if (activeQuery.dataUpdatedAt <= refreshAt.current) return;
    if (pooled.length < BROWSE_PAGE_SIZE && activeQuery.hasNextPage) return;
    forceFresh.current = false;
    setRefreshing(false);
  }, [
    refreshing,
    activeQuery.isFetching,
    activeQuery.isFetchingNextPage,
    activeQuery.hasNextPage,
    activeQuery.dataUpdatedAt,
    pooled.length,
  ]);

  async function refreshFeed() {
    if (refreshing || !settingsReady) return;
    forceFresh.current = true;
    refreshAt.current = Date.now();
    setRefreshing(true);
    setListPage(1);
    const key =
      tab === "pixiv"
        ? (["home-pixiv", feed, searchWord, searchFilter, safeMode, hideAi, pixivCookie, boardDate] as const)
        : tab === "fanbox"
          ? (["home-fanbox", fanboxFeed, creatorId, searchWord, safeMode, fanboxCookie] as const)
          : (["home-booru", tab, booruFeed, searchWord, safeMode, boardDate] as const);
    queryClient.setQueryData(key, (old: InfiniteData<FetchOk> | undefined) => {
      if (!old?.pages?.length) return old;
      return { ...old, pages: old.pages.slice(0, 1), pageParams: old.pageParams.slice(0, 1) };
    });
    try {
      await activeQuery.refetch();
    } catch {
      forceFresh.current = false;
      setRefreshing(false);
    }
  }

  const refreshButton = (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-9 rounded-full px-3 text-sm text-muted"
      disabled={!settingsReady || refreshing}
      onClick={() => void refreshFeed()}
    >
      <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
      刷新
    </Button>
  );

  function goListPage(next: number) {
    setListPage(Math.max(1, next));
    window.scrollTo({ top: 0, behavior: "instant" });
  }
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
              ? "空格分开多个标签。登录后可收藏、红心和关注。点单个标签是精确匹配。"
              : tab === "fanbox"
                ? "一次搜索一个标签，或打开创作者。"
                : `空格分开多个标签搜索 ${siteLabel(tab)}。标签里的空格写成下划线。`}
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
            saved={savedTags}
            recents={recents}
            inputId="kami-search"
            onPick={(word) => {
              setQuery(word);
              goFromInput(word);
            }}
          />
        </div>
        <div className="flex gap-2">
          {tab === "pixiv" ? (
            <PixivSearchFilter
              filter={searchFilter}
              safeMode={safeMode}
              onApply={(next) => {
                if (next.age === "r18" && safeMode) setSafeMode(false);
                setSearchFilter(next);
                const word = canonicalTag(tab, query) || query.trim();
                if (word) {
                  setSearchWord(word);
                  setQuery(word);
                }
              }}
            />
          ) : null}
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
            {searchWord ? (
              <ToggleGroup
                type="single"
                value={searchFilter.order}
                onValueChange={(v) => {
                  if (v) setSearchFilter((cur) => ({ ...cur, order: v as PixivSearchFilterValue["order"] }));
                }}
                className="ml-auto"
              >
                {PIXIV_SEARCH_ORDERS.map((item) => (
                  <ToggleGroupItem key={item.id} value={item.id}>
                    {item.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            ) : !searchWord && rankingPeriodOf(feed) ? (
              <div className="ml-auto flex h-8 shrink-0 items-center gap-2">
                <span className="min-w-[5.5rem] text-right text-xs tabular-nums text-subtle">
                  {rankingDate ? formatRankDate(rankingDate) : "\u00a0"}
                </span>
                <Input
                  type="date"
                  value={rankingDate ? formatRankDate(rankingDate) : boardDate}
                  onChange={(e) => {
                    if (e.target.value) setBoardDate(e.target.value);
                  }}
                  className="h-8 w-40"
                />
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            {refreshButton}
          </div>
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
          {refreshButton}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            value={!searchWord ? booruFeed : ""}
            onValueChange={(v) => {
              if (!v) return;
              setBooruFeed(v as BooruFeed);
              setSearchWord("");
            }}
          >
            {BOORU_FEEDS.map((item) => (
              <ToggleGroupItem key={item.id} value={item.id}>
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {!searchWord && isBooruPeriodFeed(booruFeed) ? (
            <Input
              type="date"
              value={boardDate}
              onChange={(e) => {
                if (e.target.value) setBoardDate(e.target.value);
              }}
              className="h-8 w-40"
            />
          ) : null}
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
          {refreshButton}
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
              <Button className="mt-3" variant="secondary" onClick={() => void refreshFeed()}>
                重试
              </Button>
            </AlertDescription>
          )}
        </Alert>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 text-xs text-subtle">
          <PaperMark busy className="size-3.5" />
          正在加载作品…
        </p>
      ) : null}

      {loading && items.length === 0 ? (
        <ArtworkGridSkeleton key={`${tab}-sk`} count={10} />
      ) : (
        <ArtworkGrid
          key={tab}
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

      <BrowsePager
        page={listPage}
        hasPrev={hasPrevPage}
        hasNext={hasNextPage}
        busy={activeQuery.isFetchingNextPage}
        onPage={goListPage}
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

function collectWorks(pages: FetchOk[] | undefined, source?: WorkCard["source"]): WorkCard[] {
  const seen = new Set<string>();
  const out: WorkCard[] = [];
  for (const page of pages ?? []) {
    if (!("items" in page) || page.op === "tagSuggest") continue;
    for (const work of page.items) {
      if (source && work.source !== source) continue;
      const key = `${work.source}-${work.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(work);
    }
  }
  return out;
}
