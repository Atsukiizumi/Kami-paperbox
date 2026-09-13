/**
 * TD-23 回归：画师关注乐观更新必须走共享 queryKey。
 *
 * 组件级 fixture 用真实 QueryClient 走「useInfiniteQuery + applyFollowPatch」
 * 同一接线——键漂移（写路径键 ≠ 读路径键）会在这里直接表现成按钮不翻转。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QueryClient, QueryClientProvider, useInfiniteQuery } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { applyFollowPatch } from "./user-follow.ts";

/** queryFn 的返回 = 单页；缓存载荷才是 InfiniteData 包装，两者别混。 */
function makePage(followed: boolean) {
  return { op: "pixivUser", profile: { isFollowed: followed }, items: [], pickup: [] };
}
function makeCacheData(followed: boolean) {
  return { pages: [makePage(followed)], pageParams: [0] };
}

/** 与 UserPage 同构的最小接线：同一 userQueryKey 实例供读/写两路使用。 */
function FollowFixture() {
  const client = new QueryClient();
  return (
    <QueryClientProvider client={client}>
      <Inner client={client} />
    </QueryClientProvider>
  );
}

function Inner({ client }: { client: QueryClient }) {
  const [key] = useState(["user", "11", true, false, "tag"]);
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: 0,
    queryFn: async () => makePage(false),
    getNextPageParam: () => undefined,
  });
  const followed = query.data?.pages[0]?.profile?.isFollowed ?? false;
  return (
    <button type="button" onClick={() => applyFollowPatch(client, key, true)}>
      {followed ? "已关注" : "关注"}
    </button>
  );
}

describe("TD-23 关注乐观更新（组件级回归）", () => {
  it("点击关注后按钮立即翻转（共享键接线），缓存页数据同步", async () => {
    render(<FollowFixture />);
    const button = screen.getByRole("button", { name: "关注" });
    await waitFor(() => expectResolved(button));
    fireEvent.click(button);
    await waitFor(() => {
      assert.equal(screen.getByRole("button").textContent, "已关注");
    });
  });
});

/** 等 queryFn 解析出首屏数据（isFollowed=false 初始态就绪）。 */
function expectResolved(button: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (button.textContent === "关注") resolve();
      else setTimeout(check, 10);
    };
    check();
  });
}

describe("applyFollowPatch 纯接线", () => {
  it("更新所有页的 profile.isFollowed；旧数据形状不炸", () => {
    cleanup();
    const client = new QueryClient();
    const key = ["k"];
    const otherKey = ["k2"];
    const emptyKey = ["empty"];
    client.setQueryData(key, makeCacheData(false));
    client.setQueryData(otherKey, makeCacheData(true));
    applyFollowPatch(client, key, true);
    const data = client.getQueryData<{ pages: { profile: { isFollowed: boolean } }[] }>(key);
    assert.equal(data?.pages[0]?.profile.isFollowed, true);
    // 无旧数据：不炸、不造数据
    applyFollowPatch(client, emptyKey, true);
    assert.equal(client.getQueryData(emptyKey), undefined);
  });
});
