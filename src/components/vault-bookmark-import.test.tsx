/**
 * 收藏夹导入向导测（B1-B5，design §5 T3；dom 垫片 + fetch 桩，queue.test.tsx 样板）。
 *
 * 作用：锁「未登录零请求兜 toast（B5 向导内侧）」「两页拉取停 preview + 四行计数
 *      （filterBatchable 口径 + 页间 id 去重）」「停止保留已拉」「仅新增入队 kind=vault」
 *      「>80 截断注记」「429 桥接 noteRateLimit + 从第 N+1 页继续」。
 * 环境垫片：../test/dom.ts 必须最先引入。fetch 桩两条口径：向导的 pixivMyBookmarks
 *      按页回响应序列；队列 worker 的 pixivIllust 回 200+{} ——loadWork 判
 *      r.op !== "pixivIllust" 一拍抛「返回类型异常」判死无退避（queue.test.tsx 头注），
 *      enqueueWorks 尾部 void runQueue() 不会拖死测试。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { VaultBookmarkImport } from "./vault-bookmark-import.tsx";
import { coolDownDeadline, resetRateLimitCoolDown } from "@/lib/queue-throttle";
import { useQueue, useSettings } from "@/lib/store";
import type { QueueItem } from "@/lib/types";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function card(id: number) {
  return {
    source: "pixiv" as const,
    id: String(id),
    title: `t${id}`,
    author: "画师",
    authorId: "77",
    thumb: `https://i.pximg.net/${id}.jpg`,
    pageCount: 1,
    tags: [],
  };
}

type PageSpec = { ids: number[]; total: number; nextPage: number | null; fail?: boolean };

/** 桩：/api/source 按页回 pixivMyBookmarks 序列；其余 source POST 回 200+{}；其余 404。 */
function installFetch(pages: Record<number, PageSpec>) {
  const sourceCalls: { op?: string; page?: number }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(String(init?.body ?? "{}")) as { op?: string; page?: number };
    if (url.includes("/api/source") && (init?.method ?? "GET") === "POST") {
      sourceCalls.push(body);
      if (body.op === "pixivMyBookmarks") {
        const page = pages[body.page ?? 0];
        if (!page) return json({});
        if (page.fail) return json({ error: "Pixiv 请求失败（429）" }, 502); // /api/source 对上游错误 502 透传文案
        return json({ op: "pixivMyBookmarks", items: page.ids.map(card), nextPage: page.nextPage, total: page.total });
      }
      return json({}); // 队列详情请求：一拍判死口径
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return sourceCalls;
}

function queueItem(key: string, over: Partial<QueueItem> = {}): QueueItem {
  return {
    key,
    source: "pixiv",
    id: key.slice(key.indexOf(":") + 1),
    title: `t-${key}`,
    author: "a",
    thumb: "",
    kind: "download",
    status: "queued",
    progress: 0,
    total: 1,
    addedAt: 1,
    ...over,
  };
}

const LOGGED_IN = "12345_abcdef123456";

describe("收藏夹导入向导", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    useQueue.setState({ items: [] });
    useSettings.setState({ pixivCookie: "", queueConcurrency: 4 });
    resetRateLimitCoolDown();
  });

  it("未登录：开始拉取只兜 toast，零 /api/source 请求（B5 向导内侧）", async (t) => {
    const error = t.mock.method(toast, "error", () => {});
    const calls = installFetch({});
    render(<VaultBookmarkImport inVaultKeys={new Set()} onChanged={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "开始拉取" }));
    assert.equal(error.mock.callCount(), 1);
    assert.match(String(error.mock.calls[0]?.arguments[0]), /先在设置里登录 Pixiv/);
    assert.deepEqual(calls, [], "未登录不打上游");
  });

  it("两页拉取停 preview：四行计数来自 filterBatchable，页间同 id 去重", async () => {
    useSettings.setState({ pixivCookie: LOGGED_IN });
    useQueue.setState({ items: [queueItem("pixiv:3")] });
    installFetch({
      1: { ids: [1, 2, 3], total: 4, nextPage: 2 },
      2: { ids: [3, 4], total: 4, nextPage: null }, // id 3 与第 1 页重复 → 去重
    });
    render(<VaultBookmarkImport inVaultKeys={new Set(["pixiv:4"])} onChanged={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "开始拉取" }));
    await waitFor(() => assert.match(document.body.textContent ?? "", /可入队\s*2/), { timeout: 4000 });
    const text = document.body.textContent ?? "";
    assert.match(text, /收藏夹总数\s*4/);
    assert.match(text, /已在纸匣\s*1/);
    assert.match(text, /已在队列\s*1/);
    assert.match(text, /可入队\s*2/, "重复 id 已去重、纸匣/队列命中各跳过 1");
  });

  it("「停止」保留已拉部分直接进 preview，页边界生效", async () => {
    useSettings.setState({ pixivCookie: LOGGED_IN });
    const calls = installFetch({
      1: { ids: [1, 2, 3], total: 100, nextPage: 2 },
      2: { ids: [4], total: 100, nextPage: null },
    });
    render(<VaultBookmarkImport inVaultKeys={new Set()} onChanged={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "开始拉取" }));
    await waitFor(() => assert.match(document.body.textContent ?? "", /已拉 3/), { timeout: 4000 });
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    await waitFor(() => assert.match(document.body.textContent ?? "", /可入队\s*3/), { timeout: 4000 });
    assert.equal(calls.filter((c) => c.op === "pixivMyBookmarks").length, 1, "停止后下一页不再请求");
  });

  it("「全部入队（收入纸匣）」：仅新增口径 kind=vault，onChanged/onClose 各一次", async (t) => {
    const success = t.mock.method(toast, "success", () => {});
    useSettings.setState({ pixivCookie: LOGGED_IN });
    installFetch({ 1: { ids: [1, 2, 3], total: 3, nextPage: null } });
    let changed = 0;
    let closed = 0;
    render(
      <VaultBookmarkImport
        inVaultKeys={new Set(["pixiv:3"])}
        onChanged={() => {
          changed += 1;
        }}
        onClose={() => {
          closed += 1;
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "开始拉取" }));
    await waitFor(() => assert.match(document.body.textContent ?? "", /可入队\s*2/), { timeout: 4000 });
    fireEvent.click(screen.getByRole("button", { name: "全部入队（收入纸匣）" }));
    assert.deepEqual(
      useQueue.getState().items.map((x) => `${x.key}:${x.kind}`).sort(),
      ["pixiv:1:vault", "pixiv:2:vault"],
      "已在纸匣的 pixiv:3 不入队，入队 kind=vault",
    );
    assert.match(String(success.mock.calls[0]?.arguments[0]), /已入队：纸匣 2 张/);
    await waitFor(() => assert.equal(closed, 1, "完成后通知父级刷新再关闭"), { timeout: 4000 });
    assert.equal(changed, 1);
  });

  it(">80 张：BATCH_MAX 截断进 toast 注记", async (t) => {
    const success = t.mock.method(toast, "success", () => {});
    useSettings.setState({ pixivCookie: LOGGED_IN });
    installFetch({
      1: { ids: Array.from({ length: 48 }, (_, i) => i + 1), total: 96, nextPage: 2 },
      2: { ids: Array.from({ length: 48 }, (_, i) => i + 49), total: 96, nextPage: null },
    });
    render(<VaultBookmarkImport inVaultKeys={new Set()} onChanged={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "开始拉取" }));
    await waitFor(() => assert.match(document.body.textContent ?? "", /可入队\s*96/), { timeout: 4000 });
    fireEvent.click(screen.getByRole("button", { name: "全部入队（收入纸匣）" }));
    assert.equal(useQueue.getState().items.length, 80, "BATCH_MAX=80 截断");
    assert.match(String(success.mock.calls[0]?.arguments[0]), /队列只保留 80 张，这次有 16 张没排进去/);
    // 入队即开跑（void runQueue），后台把 80 条逐波判死； afterEach 清空队列即收尾，不断言终态
  });

  it("429 失败：noteRateLimit 桥接下载队列冷却，出「从第 N+1 页继续」", async () => {
    useSettings.setState({ pixivCookie: LOGGED_IN });
    installFetch({ 1: { ids: [1], total: 10, nextPage: 2, fail: true } });
    render(<VaultBookmarkImport inVaultKeys={new Set()} onChanged={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "开始拉取" }));
    await waitFor(() => assert.match(document.body.textContent ?? "", /拉取失败/));
    assert.ok(coolDownDeadline() > 0, "429 文案桥接 noteRateLimit：下载队列同步进 90s 冷却");
    assert.match(document.body.textContent ?? "", /从第 1 页继续/, "第 1 页失败 → 从第 1 页继续");
  });
});
