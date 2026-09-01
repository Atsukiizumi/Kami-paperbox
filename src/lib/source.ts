/**
 * 浏览器 → 服务端的唯一入口。
 *
 * 作用：校验参数后调用 upstream / social。Cookie 只在服务端发出。
 * 用法：fetchSource({ data: { op: "pixivRanking", ... } })；mutateSource 做红心收藏。
 * 为什么：createServerFn 保证 UI 打不到 pixiv.net；zod 挡住胡来的 id/page。
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PIXIV_RANK_IDS } from "./pixiv-feed";
import type { FanboxCursor, FetchInput, FetchOk, SocialInput, SocialOk } from "./types";

const cursorSchema = z
  .object({
    datetime: z.string().max(64),
    id: z.string().regex(/^\d+$/),
  })
  .optional();

const fetchSchema = z.intersection(
  z.object({
    pixivCookie: z.string().max(8192).optional(),
    fanboxCookie: z.string().max(8192).optional(),
    safeMode: z.boolean().optional(),
    hideAi: z.boolean().optional(),
  }),
  z.discriminatedUnion("op", [
    z.object({
      op: z.literal("pixivRanking"),
      mode: z.enum(PIXIV_RANK_IDS),
      page: z.number().int().min(1).max(10),
    }),
    z.object({
      op: z.literal("pixivSearch"),
      word: z.string().min(1).max(80),
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
      feed: z.enum(["recent", "popular"]),
      tags: z.string().max(80).optional(),
      page: z.number().int().min(1).max(50),
    }),
    z.object({
      op: z.literal("booruPost"),
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

export const fetchSource = createServerFn({ method: "POST" })
  .validator((data: unknown) => fetchSchema.parse(data) as FetchInput)
  .handler(async ({ data }): Promise<FetchOk> => {
    const { dispatchFetch } = await import("./upstream.server");
    return dispatchFetch(data);
  });

const socialSchema = z.intersection(
  z.object({
    pixivCookie: z.string().max(8192).optional(),
    fanboxCookie: z.string().max(8192).optional(),
  }),
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("pixivLike"), id: z.string().regex(/^\d{1,12}$/) }),
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

export const mutateSource = createServerFn({ method: "POST" })
  .validator((data: unknown) => socialSchema.parse(data) as SocialInput)
  .handler(async ({ data }): Promise<SocialOk> => {
    const { dispatchSocial } = await import("./social.server");
    return dispatchSocial(data);
  });

/** 登录后预拉 CSRF，点红心时只打 like，不再先扒首页。 */
export function warmPixivCsrf(pixivCookie?: string) {
  const cookie = pixivCookie?.trim();
  if (!cookie) return;
  void mutateSource({ data: { op: "pixivWarm", pixivCookie: cookie } }).catch(() => undefined);
}

const sessionSchema = z.object({
  pixiv: z.string().max(8192).optional(),
  fanbox: z.string().max(8192).optional(),
});

export const saveSessions = createServerFn({ method: "POST" })
  .validator((data: unknown) => sessionSchema.parse(data))
  .handler(async ({ data }) => {
    const { setResponseHeader } = await import("@tanstack/react-start/server");
    const { fanboxSessionFrom, sanitizePixivCookie } = await import("./browser-login");
    const pixiv = sanitizePixivCookie(data.pixiv ?? "");
    const fanbox = fanboxSessionFrom(data.fanbox, pixiv);
    const pixivVal = pixiv ? encodeURIComponent(pixiv) : "";
    const fanboxVal = fanbox ? encodeURIComponent(fanbox) : "";
    const parts = [
      `kami_pixiv=${pixivVal}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${pixiv ? 2592000 : 0}`,
      `kami_fanbox=${fanboxVal}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${fanbox ? 2592000 : 0}`,
    ];
    setResponseHeader("Set-Cookie", parts);
    return { ok: true as const };
  });

export type { FanboxCursor };
