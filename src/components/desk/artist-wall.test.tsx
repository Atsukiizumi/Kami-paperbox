/**
 * 案头画师墙轻量渲染测（dom 垫片 + 预热的 react-query 缓存 + 假时钟）。
 *
 * 作用：锁「未登录 / 流空 / 无缩略图 / 不足 3 → 整块不出现」与
 *      「3–8 张静态展示、9 张起 3 列墙、格子进作品页」的回退；缓存预热避免真发请求。
 *      假时钟：setQueryData 会在真事件循环上留 gc 定时器吊住测试进程，
 *      mock 掉 setTimeout 后由 tick 驱动（与 use-crossfade 测试同款）。
 * 环境垫片：../../test/dom.ts 必须最先引入。
 */
import "../../test/dom.ts";
// next/link 的 use-intersection 在 effect 里读 self.requestIdleCallback；Node 全局
// 没有 self，垫成 jsdom window（rIC 缺失时 next 自己回退 setTimeout，被假时钟接管）。
(globalThis as { self?: unknown }).self = window;
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { DeskArtistWall } from "./artist-wall.tsx";
import { useSettings } from "@/lib/store";
import { credentialTag } from "@/lib/sync/cred-tag";
import type { WorkCard } from "@/lib/types";

const LOGGED_IN_COOKIE = "PHPSESSID=123456_ABCDEFGHIJ";

/** 与组件内的 queryKey 同构：desk-artist-wall + 凭据指纹（随测试态 cookie 变化）。 */
const artistWallQueryKey = (cookie: string) => ["desk-artist-wall", credentialTag(cookie)];

function followingResult(items: WorkCard[]) {
  return { op: "pixivFollowing", items, nextPage: null };
}

function worksWithThumbs(n: number): WorkCard[] {
  return Array.from({ length: n }, (_, i) => ({
    source: "pixiv" as const,
    id: String(9000 + i),
    title: `作品${i}`,
    author: `画师${i % 3}`,
    authorId: String(100 + (i % 3)),
    thumb: `https://i.pximg.example/${i}.jpg`,
    pageCount: 1,
    tags: [],
  }));
}

function renderWall(cookie: string, data?: unknown) {
  // gcTime 0：测试不挂观察者的缓存条目立刻回收，不留 5 分钟 gc 定时器。
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  if (data !== undefined) client.setQueryData(artistWallQueryKey(cookie), data);
  return render(
    <QueryClientProvider client={client}>
      <DeskArtistWall />
    </QueryClientProvider>,
  );
}

describe("DeskArtistWall（案头画师墙）", () => {
  beforeEach(() => {
    cleanup();
    useSettings.setState({ watchArtists: [], pixivCookie: "" });
  });

  it("未登录 Pixiv（cookie 空）→ 不出现，缓存有旧数据也不出", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { container } = renderWall("", followingResult(worksWithThumbs(12)));
    assert.equal(container.childElementCount, 0);
  });

  it("关注新作品流为空 → 不出现", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    useSettings.setState({ pixivCookie: LOGGED_IN_COOKIE });
    const { container } = renderWall(LOGGED_IN_COOKIE, followingResult([]));
    assert.equal(container.childElementCount, 0);
  });

  it("流里没有缩略图 → 不出现", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    useSettings.setState({ pixivCookie: LOGGED_IN_COOKIE });
    const { container } = renderWall(
      LOGGED_IN_COOKIE,
      followingResult(worksWithThumbs(4).map((w) => ({ ...w, thumb: "" }))),
    );
    assert.equal(container.childElementCount, 0);
  });

  it("不足 3 张 → 砌不成墙，不出现", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    useSettings.setState({ pixivCookie: LOGGED_IN_COOKIE });
    const { container } = renderWall(LOGGED_IN_COOKIE, followingResult(worksWithThumbs(2)));
    assert.equal(container.childElementCount, 0);
  });

  it("3–8 张不硬凑：静态展示现有几张（5 张 5 格）", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    useSettings.setState({ pixivCookie: LOGGED_IN_COOKIE });
    const { container } = renderWall(LOGGED_IN_COOKIE, followingResult(worksWithThumbs(5)));
    await act(async () => {
      t.mock.timers.tick(30);
    });
    const cells = container.querySelectorAll("a[href^='/work/']");
    assert.equal(cells.length, 5);
  });

  it("有图 → 3 列方格墙上场，格子进作品页；追踪名单为空也照出", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    useSettings.setState({ pixivCookie: LOGGED_IN_COOKIE });
    // 9 张：动态批量 clamp 到 9 → 1 帧，静态单层网格 9 格
    const { container } = renderWall(LOGGED_IN_COOKIE, followingResult(worksWithThumbs(9)));
    // next/link 的 idle 预取回退在 act 里 tick 收尾，避免测试后异步状态更新。
    await act(async () => {
      t.mock.timers.tick(30);
    });
    const cells = container.querySelectorAll("a[href^='/work/']");
    assert.equal(cells.length, 9);
    assert.match(cells[0]?.getAttribute("href") ?? "", /\/work\/pixiv\/90\d\d/);
    const grid = cells[0]?.closest("div");
    assert.match(grid?.className ?? "", /grid-cols-3/);
  });
});
