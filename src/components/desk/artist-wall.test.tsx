/**
 * 案头画师墙轻量渲染测（dom 垫片 + 预热的 react-query 缓存 + 假时钟）。
 *
 * 作用：锁「无追踪 / 流空 / 无头像 → 整块不出现」的回退；缓存预热避免真发请求。
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

type WallArtist = { id: string; name: string; avatar: string };

/** 与组件内的 queryKey 同构：desk-artist-wall + 凭据指纹（测试态 cookie 为空）。 */
const artistWallQueryKey = ["desk-artist-wall", credentialTag("")];

function followingResult(items: WallArtist[]) {
  return { op: "pixivMyFollowing", items, nextPage: null };
}

function renderWall(data?: unknown) {
  // gcTime 0：测试不挂观察者的缓存条目立刻回收，不留 5 分钟 gc 定时器。
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  if (data !== undefined) client.setQueryData(artistWallQueryKey, data);
  return render(
    <QueryClientProvider client={client}>
      <DeskArtistWall />
    </QueryClientProvider>,
  );
}

describe("DeskArtistWall（案头画师墙）", () => {
  beforeEach(() => {
    cleanup();
    useSettings.setState({ watchArtists: [] });
  });

  it("无追踪画师 → 不出现", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { container } = renderWall(followingResult([]));
    assert.equal(container.childElementCount, 0);
  });

  it("关注流为空 → 不出现", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    useSettings.setState({
      watchArtists: [{ source: "pixiv", id: "1", name: "画师A", avatar: "", addedAt: 1 }],
    });
    const { container } = renderWall(followingResult([]));
    assert.equal(container.childElementCount, 0);
  });

  it("关注流里没有头像 → 不出现", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    useSettings.setState({
      watchArtists: [{ source: "pixiv", id: "1", name: "画师A", avatar: "", addedAt: 1 }],
    });
    const { container } = renderWall(
      followingResult([{ id: "7", name: "画师B", avatar: "" }]),
    );
    assert.equal(container.childElementCount, 0);
  });

  it("有关注头像 → 3 列方格墙上场，格子进画师页", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    useSettings.setState({
      watchArtists: [{ source: "pixiv", id: "1", name: "画师A", avatar: "", addedAt: 1 }],
    });
    // 9 张：动态批量 clamp 到 9 → 1 帧，静态单层网格 9 格
    const artists: WallArtist[] = Array.from({ length: 9 }, (_, i) => ({
      id: String(100 + i),
      name: `画师${i}`,
      avatar: `https://i.pximg.example/${i}.jpg`,
    }));
    const { container } = renderWall(followingResult(artists));
    // next/link 的 idle 预取回退在 act 里 tick 收尾，避免测试后异步状态更新。
    await act(async () => {
      t.mock.timers.tick(30);
    });
    const cells = container.querySelectorAll("a[href^='/user/']");
    assert.equal(cells.length, 9);
    const grid = cells[0]?.closest("div");
    assert.match(grid?.className ?? "", /grid-cols-3/);
  });
});
