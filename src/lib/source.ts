/**
 * 浏览器 → 服务端的唯一入口。
 *
 * 作用：校验参数后调用 upstream / social。Cookie 只在服务端发出。
 * 用法：fetchSource({ data: { op: "pixivRanking", ... } })；mutateSource 做红心收藏。
 * 为什么：浏览器只打本站 `/api/source`，Cookie 和上游请求留在服务端。zod 挡住胡来的 id/page。
 */
import { z } from "zod";
import { PIXIV_RANK_IDS } from "./pixiv-feed";
import { BOORU_FEED_IDS } from "./booru";
import type { FanboxCursor, FetchInput, FetchOk, SocialInput, SocialOk } from "./types";

const cursorSchema = z
  .object({
    datetime: z.string().max(64),
    id: z.string().regex(/^\d+$/),
  })
  .optional();

export const fetchSchema = z.intersection(
  z.object({
    pixivCookie: z.string().max(8192).optional(),
    fanboxCookie: z.string().max(8192).optional(),
    safeMode: z.boolean().optional(),
    hideAi: z.boolean().optional(),
    fresh: z.boolean().optional(),
  }),
  z.discriminatedUnion("op", [
    z.object({
      op: z.literal("pixivRanking"),
      mode: z.enum(PIXIV_RANK_IDS),
      page: z.number().int().min(1).max(10),
      date: z.string().regex(/^\d{8}$/).optional(),
    }),
    z.object({
      op: z.literal("pixivSearch"),
      word: z.string().min(1).max(200),
      page: z.number().int().min(1).max(20),
      filter: z
        .object({
          scope: z.enum(["s_tag", "s_tag_full", "s_tc"]).optional(),
          type: z.enum(["all", "illust", "manga", "ugoira"]).optional(),
          order: z.enum(["date_d", "date", "popular_d"]).optional(),
          age: z.enum(["all", "safe", "r18"]).optional(),
          when: z.enum(["any", "d", "w", "m"]).optional(),
          bookmarks: z.enum(["0", "100", "250", "500", "1000", "5000"]).optional(),
          ratio: z.enum(["all", "landscape", "portrait", "square"]).optional(),
        })
        .optional(),
    }),
    z.object({ op: z.literal("pixivRecommend") }),
    z.object({
      op: z.literal("pixivFollowing"),
      page: z.number().int().min(1).max(20),
    }),
    z.object({
      op: z.literal("pixivRelated"),
      id: z.string().regex(/^\d{1,12}$/),
    }),
    z.object({
      op: z.literal("pixivIllust"),
      id: z.string().regex(/^\d{1,12}$/),
    }),
    z.object({
      op: z.literal("pixivUgoira"),
      id: z.string().regex(/^\d{1,12}$/),
    }),
    z.object({
      op: z.literal("pixivUser"),
      id: z.string().regex(/^\d{1,12}$/),
      offset: z.number().int().min(0).max(4000).optional(),
    }),
    z.object({
      op: z.literal("fanboxCreator"),
      id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
      cursor: cursorSchema,
    }),
    z.object({ op: z.literal("fanboxHome"), cursor: cursorSchema }),
    z.object({ op: z.literal("fanboxSupporting"), cursor: cursorSchema }),
    z.object({
      op: z.literal("fanboxPost"),
      id: z.string().regex(/^\d{1,12}$/),
    }),
    z.object({
      op: z.literal("fanboxTagged"),
      tag: z.string().min(1).max(80),
      page: z.number().int().min(1).max(20),
    }),
    z.object({
      op: z.literal("booruList"),
      site: z.enum(["yande", "konachan", "danbooru"]),
      feed: z.enum(BOORU_FEED_IDS),
      tags: z.string().max(240).optional(),
      page: z.number().int().min(1).max(50),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    z.object({
      op: z.literal("booruPost"),
      site: z.enum(["yande", "konachan", "danbooru"]),
      id: z.string().regex(/^\d{1,12}$/),
    }),
    z.object({
      op: z.literal("booruPool"),
      site: z.enum(["yande", "konachan", "danbooru"]),
      id: z.string().regex(/^\d{1,12}$/),
    }),
    z.object({
      op: z.literal("tagSuggest"),
      source: z.enum(["pixiv", "fanbox", "yande", "konachan", "danbooru"]),
      word: z.string().min(1).max(80),
    }),
  ]),
);

export const socialSchema = z.intersection(
  z.object({
    pixivCookie: z.string().max(8192).optional(),
    fanboxCookie: z.string().max(8192).optional(),
  }),
  z.discriminatedUnion("op", [
    z.object({
      op: z.literal("pixivLike"),
      id: z.string().regex(/^\d{1,12}$/),
      tags: z.array(z.string().max(40)).max(12).optional(),
    }),
    z.object({ op: z.literal("pixivWarm") }),
    z.object({
      op: z.literal("pixivBookmark"),
      id: z.string().regex(/^\d{1,12}$/),
      on: z.boolean(),
      tags: z.array(z.string().max(40)).max(12).optional(),
      bookmarkId: z.string().max(24).optional(),
    }),
    z.object({
      op: z.literal("pixivFollow"),
      userId: z.string().regex(/^\d{1,12}$/),
      on: z.boolean(),
    }),
    z.object({ op: z.literal("fanboxLike"), id: z.string().regex(/^\d{1,12}$/) }),
    z.object({
      op: z.literal("fanboxFollow"),
      creatorId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
      on: z.boolean(),
    }),
  ]),
);

export const fetchSource = async ({ data }: { data: FetchInput }): Promise<FetchOk> => {
  const res = await fetch("/api/source", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = (await res.json().catch(() => null)) as FetchOk | { error?: string } | null;
  if (!res.ok) {
    throw new Error(body && "error" in body && body.error ? body.error : `请求失败（${res.status}）`);
  }
  return body as FetchOk;
};

export const mutateSource = async ({ data }: { data: SocialInput }): Promise<SocialOk> => {
  const res = await fetch("/api/social", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = (await res.json().catch(() => null)) as SocialOk | { error?: string } | null;
  if (!res.ok) {
    throw new Error(body && "error" in body && body.error ? body.error : `请求失败（${res.status}）`);
  }
  return body as SocialOk;
};

/** 登录后预拉 CSRF，点红心时只打 like，不再先扒首页。 */
export function warmPixivCsrf(pixivCookie?: string) {
  const cookie = pixivCookie?.trim();
  if (!cookie) return;
  void mutateSource({ data: { op: "pixivWarm", pixivCookie: cookie } }).catch(() => undefined);
}

export const sessionSchema = z.object({
  pixiv: z.string().max(8192).optional(),
  fanbox: z.string().max(8192).optional(),
});

export const saveSessions = async ({ data }: { data: z.infer<typeof sessionSchema> }) => {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
    credentials: "same-origin",
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok) {
    throw new Error(body?.error || `会话写入失败（${res.status}）`);
  }
  return { ok: true as const };
};

export type { FanboxCursor };
