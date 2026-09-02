/**
 * 纸匣里流转的数据结构。
 *
 * 作用：卡片、作品详情、队列项、纸匣目录条目。上游 JSON 不要直接传给 UI。
 * 用法：WorkCard 浏览；WorkDetail 作品页；VaultMeta 纸匣（可带 relativePath 对磁盘）。
 */
import type { UgoiraMeta } from "./ugoira-meta";
import type { PixivRankMode } from "./pixiv-feed";
import type { PixivSearchFilter } from "./pixiv-search";

export type { UgoiraMeta } from "./ugoira-meta";
export type { PixivRankMode, PixivFeed } from "./pixiv-feed";
export type { PixivSearchFilter } from "./pixiv-search";

export type Source = "pixiv" | "fanbox" | "yande" | "konachan" | "danbooru";
export type BooruSite = "yande" | "konachan" | "danbooru";

export type TagSuggestItem = {
  tag: string;
  extra?: string;
};

export type WorkCard = {
  source: Source;
  id: string;
  title: string;
  author: string;
  authorId: string;
  thumb: string;
  pageCount: number;
  tags: string[];
  width?: number;
  height?: number;
  restricted?: boolean;
  feeRequired?: number;
  date?: string;
  illustType?: number;
  aiType?: number;
  rating?: string;
  excerpt?: string;
  liked?: boolean;
  bookmarked?: boolean;
};

export type WorkPage = {
  thumb: string;
  regular: string;
  original: string;
  name?: string;
  bytes?: number;
  width?: number;
  height?: number;
};

export type WorkDetail = WorkCard & {
  description: string;
  pages: WorkPage[];
  views?: number;
  bookmarks?: number;
  likes?: number;
  excerpt?: string;
  ugoira?: UgoiraMeta;
  liked?: boolean;
  bookmarked?: boolean;
  bookmarkId?: string;
  followed?: boolean;
};

export type UserProfile = {
  id: string;
  name: string;
  avatar: string;
  comment: string;
  following?: number;
  totalWorks: number;
  isFollowed?: boolean;
};

export type CreatorProfile = {
  id: string;
  name: string;
  avatar: string;
  description: string;
  cover?: string;
  isSupported?: boolean;
  isFollowed?: boolean;
  hasAdultContent?: boolean;
};

export type FanboxCursor = {
  datetime: string;
  id: string;
};

export type FetchOk =
  | { op: "pixivRanking"; date: string; items: WorkCard[]; nextPage: number | null }
  | { op: "pixivSearch"; items: WorkCard[]; nextPage: number | null }
  | { op: "pixivRecommend"; items: WorkCard[]; nextPage: number | null }
  | { op: "pixivFollowing"; items: WorkCard[]; nextPage: number | null }
  | { op: "pixivRelated"; items: WorkCard[] }
  | { op: "pixivIllust"; work: WorkDetail }
  | {
      op: "pixivUser";
      profile: UserProfile;
      items: WorkCard[];
      pickup: WorkCard[];
      newestId?: string;
      total: number;
      listTotal: number;
      offset: number;
    }
  | {
      op: "fanboxCreator";
      profile: CreatorProfile;
      items: WorkCard[];
      cursor: FanboxCursor | null;
    }
  | { op: "fanboxHome"; items: WorkCard[]; cursor: FanboxCursor | null }
  | { op: "fanboxSupporting"; items: WorkCard[]; cursor: FanboxCursor | null }
  | { op: "fanboxPost"; work: WorkDetail }
  | { op: "fanboxTagged"; items: WorkCard[]; nextPage: number | null }
  | { op: "booruList"; site: BooruSite; items: WorkCard[]; nextPage: number | null }
  | { op: "booruPost"; work: WorkDetail }
  | { op: "tagSuggest"; items: TagSuggestItem[] };

export type FetchInput = {
  pixivCookie?: string;
  fanboxCookie?: string;
  safeMode?: boolean;
  hideAi?: boolean;
} & (
  | { op: "pixivRanking"; mode: PixivRankMode; page: number }
  | { op: "pixivSearch"; word: string; page: number; filter?: PixivSearchFilter }
  | { op: "pixivRecommend" }
  | { op: "pixivFollowing"; page: number }
  | { op: "pixivRelated"; id: string }
  | { op: "pixivIllust"; id: string }
  | { op: "pixivUser"; id: string; offset?: number }
  | { op: "fanboxCreator"; id: string; cursor?: FanboxCursor }
  | { op: "fanboxHome"; cursor?: FanboxCursor }
  | { op: "fanboxSupporting"; cursor?: FanboxCursor }
  | { op: "fanboxPost"; id: string }
  | { op: "fanboxTagged"; tag: string; page: number }
  | { op: "booruList"; site: BooruSite; feed: "recent" | "popular"; tags?: string; page: number }
  | { op: "booruPost"; site: BooruSite; id: string }
  | { op: "tagSuggest"; source: Source; word: string }
);

export type SocialInput = {
  pixivCookie?: string;
  fanboxCookie?: string;
} & (
  | { op: "pixivLike"; id: string; tags?: string[] }
  | { op: "pixivWarm" }
  | { op: "pixivBookmark"; id: string; on: boolean; tags?: string[]; bookmarkId?: string }
  | { op: "pixivFollow"; userId: string; on: boolean }
  | { op: "fanboxLike"; id: string }
  | { op: "fanboxFollow"; creatorId: string; on: boolean }
);

export type SocialOk = {
  ok: true;
  liked?: boolean;
  bookmarked?: boolean;
  bookmarkId?: string;
  followed?: boolean;
};

export type QueueKind = "download" | "vault";

export type QueueItem = {
  key: string;
  source: Source;
  id: string;
  title: string;
  author: string;
  thumb: string;
  kind: QueueKind;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  total: number;
  error?: string;
  addedAt: number;
};

export type VaultMeta = {
  key: string;
  source: Source;
  id: string;
  title: string;
  author: string;
  authorId: string;
  tags: string[];
  pageCount: number;
  savedAt: number;
  bytes: number;
  relativePath?: string;
  folderLabel?: string;
  sha256?: string;
  replaced?: boolean;
  origin?: "folder" | "app";
};
