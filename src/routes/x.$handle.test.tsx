/**
 * XPreviewPage（X 预览页 /x/{handle}，M6，AC3/AC4 前半）RTL。
 *
 * 作用：锁「有 Cookie 时渲染媒体卡网格 + 光标无限翻页（sensitive 角标 / 多图
 *      计数 / 截断题注走 ArtworkCard 既有视觉）」「无 Cookie 内联引导卡 + 直达
 *      设置锚点且零上游请求」「Cookie 失效 / 用户不存在错误同引导」「批量勾选
 *      → filterBatchable → enqueueWorks（source="x"，已在队列跳过）」「顶栏
 *      反查画师页链接（仅忽略记录不算关联，M5 判据）」。
 * 样板：work.$source.$id.test.tsx（AppRouter/PathParams 桩 + registerHooks CSS）
 *      + vault-bookmark-import.test.tsx（fetch 桩；队列详情请求回 200+{} 一拍
 *      判死口径，enqueueWorks 尾部 runQueue 不拖死测试）。
 * 环境垫片：../test/dom.ts 必须最先引入。
 */
import "../test/dom.ts";
import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { useQueue, useSettings } from "@/lib/store";
import type { QueueItem, WorkCard, XAssociation } from "@/lib/types";

registerHooks({
  load(url, context, nextLoad) {
    if (url.split("?")[0].endsWith(".css")) {
      return { format: "module", source: "export default {}", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

{
  const w = window as unknown as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  for (const key of ["Event", "CustomEvent", "MouseEvent", "PointerEvent", "KeyboardEvent", "FocusEvent", "MutationObserver"]) {
    if (w[key] !== undefined) g[key] = w[key];
  }
  if (g.indexedDB === undefined) g.indexedDB = { open: () => ({}) };
}

const { XPreviewPage } = await import("./x.$handle.tsx");

// dom.ts 的 IntersectionObserver 桩不存构造回调（observe 永不触发），哨兵自动
// 翻页测不到——换「构造存回调、observe 即报进入视口」的触发桩（仅本测试进程）。
// ProxiedImg 懒加载同受触发，只是让图片在 jsdom 里同步挂载，无副作用。
{
  class AutoFireIO {
    private cb: (entries: { target: unknown; isIntersecting: boolean }[]) => void;
    constructor(cb: AutoFireIO["cb"]) {
      this.cb = cb;
    }
    observe(target: unknown) {
      this.cb([{ target, isIntersecting: true }]);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  globalThis.IntersectionObserver = AutoFireIO as unknown as typeof IntersectionObserver;
}

const stubRouter = {
  push: () => undefined,
  replace: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
  refresh: () => undefined,
};

const X_COOKIE = "auth_token=aaaaaaaaaaaaaaaa; ct0=bbbbbbbbbbbbbbbb";
const X_USER = { restId: "738706683061374977", name: "まさら", avatar: "https://pbs.twimg.com/profile_images/a_normal.jpg" };

function xCard(id: string, over: Partial<WorkCard> = {}): WorkCard {
  return {
    source: "x",
    id,
    title: `推文${id}`,
    author: "まさら@masara_ASM1",
    authorId: X_USER.restId,
    thumb: `https://pbs.twimg.com/media/${id}.jpg?format=jpg&name=small`,
    pageCount: 1,
    tags: [],
    ...over,
  };
}

type SourceCall = { op?: string; handle?: string; cursor?: string };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * 桩：/api/source 按用例回 xUserMedia 页序列（按 cursor 区分）；xUserMedia 之外
 * 的 op（批量入队后 runQueue 的 xTweet 详情）回 200+{} ——loadWork 判错 op 一拍
 * 抛「返回类型异常」判死无退避（queue.test.tsx 头注口径）。其余端点 404。
 */
function installFetch(pages: Record<string, { items: WorkCard[]; nextCursor?: string }>, calls: SourceCall[]) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/source") && (init?.method ?? "GET") === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as SourceCall;
      if (body.op !== "xUserMedia") return json({});
      calls.push(body);
      const page = pages[body.cursor ?? ""];
      if (!page) return json({ error: "X 请求失败（429）" }, 502);
      return json({ op: "xUserMedia", items: page.items, user: X_USER, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

/** 固定错误响应桩（Cookie 失效 / 用户不存在用例）。 */
function installErrorFetch(error: string, status: number, calls: SourceCall[]) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/source") && (init?.method ?? "GET") === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as SourceCall;
      calls.push(body);
      return json({ error }, status);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function renderPage(handle = "masara") {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AppRouterContext.Provider value={stubRouter as never}>
        <PathParamsContext.Provider value={{ handle } as never}>
          <XPreviewPage />
        </PathParamsContext.Provider>
      </AppRouterContext.Provider>
    </QueryClientProvider>,
  );
}

const SINGLE_PAGE = {
  "": {
    items: [xCard("c1"), xCard("c2", { xRestrict: 1 }), xCard("c3", { pageCount: 4 })],
  },
};

describe("XPreviewPage（X 预览页）", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    cleanup();
    useSettings.setState({ xCookie: X_COOKIE, xAssociations: {} });
    useQueue.setState({ items: [] });
  });
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    useSettings.setState({ xCookie: "", xAssociations: {} });
    useQueue.setState({ items: [] });
  });

  it("有 Cookie：渲染媒体卡网格 + 顶栏用户信息；光标无限翻页带 cursor；sensitive / 多图角标", async () => {
    const calls: SourceCall[] = [];
    installFetch(
      {
        "": { items: [xCard("c1"), xCard("c2", { xRestrict: 1 }), xCard("c3", { pageCount: 4 })], nextCursor: "CUR2" },
        CUR2: { items: [xCard("c4")] },
      },
      calls,
    );
    renderPage();
    // 顶栏：名字 + @handle（首屏加载完随第一页带回）
    assert.ok(await screen.findByText("まさら"), "用户显示名");
    assert.ok(screen.getByText("@masara"), "handle");
    // 第二页由 InfiniteSentinel 自动触发（dom.ts 的 IntersectionObserver 桩立即命中）
    assert.ok(await screen.findByText("推文c4"), "第二页卡片");
    await waitFor(() => assert.equal(calls.length, 2, "两页各一次请求，游标翻到底停"));
    assert.equal(calls[0]?.op, "xUserMedia");
    assert.equal(calls[0]?.handle, "masara");
    assert.equal(calls[0]?.cursor, undefined, "首页无游标");
    assert.equal(calls[1]?.cursor, "CUR2", "下一页带上一页 Bottom 游标");
    // 卡面：sensitive 角标（xRestrict→R-18 既有视觉）+ 多图计数
    assert.ok(screen.getByText("R-18"), "sensitive 推带 R-18 角标");
    assert.ok(screen.getByText("4p"), "4 图推带计数");
    assert.ok(screen.getByText("推文c1"), "截断题注即卡片标题");
  });

  it("无 Cookie：内联引导卡 + 直达设置锚点，零 /api/source 请求（AC3）", async () => {
    useSettings.setState({ xCookie: "" });
    const calls: SourceCall[] = [];
    installFetch(SINGLE_PAGE, calls);
    renderPage();
    assert.ok(await screen.findByText("还没填 X Cookie"), "引导标题不静默空态");
    const link = screen.getByRole("link", { name: "去设置填 X Cookie" });
    assert.equal(link.getAttribute("href"), "/settings#accounts", "直达设置→账号 锚点");
    assert.deepEqual(calls, [], "查询 disabled，不打上游");
  });

  it("Cookie 失效（XCookieExpiredError 文案）与「用户不存在或 Cookie 已失效」错误态同引导", async () => {
    const cases: [string, number][] = [
      ["X Cookie 已失效，请到设置更新", 400],
      ["X 用户不存在或 Cookie 已失效", 502],
    ];
    for (const [error, status] of cases) {
      cleanup();
      const calls: SourceCall[] = [];
      installErrorFetch(error, status, calls);
      renderPage();
      assert.ok(await screen.findByText("X Cookie 已失效"), `${error} → 失效引导卡`);
      assert.ok(screen.getByRole("link", { name: "去设置填 X Cookie" }), "引导带设置直达");
      assert.equal(screen.queryByText("推文c1"), null, "不出网格");
      assert.ok(calls.length >= 1);
    }
  });

  it("批量入队：勾选 → filterBatchable（已在队列跳过）→ enqueueWorks source=x；引导外的上游错误走重试卡", async () => {
    const calls: SourceCall[] = [];
    installFetch(SINGLE_PAGE, calls);
    // 预置一条在队列里的 c2：filterBatchable 应跳过
    const queued: QueueItem = {
      key: "x:c2",
      source: "x",
      id: "c2",
      title: "推文c2",
      author: "a",
      thumb: "",
      kind: "download",
      status: "queued",
      progress: 0,
      total: 1,
      addedAt: 1,
    };
    useQueue.setState({ items: [queued] });
    renderPage();
    assert.ok(await screen.findByText("推文c1"));
    fireEvent.click(screen.getByRole("button", { name: "批量收藏" }));
    const chips = screen.getAllByLabelText("选择");
    assert.equal(chips.length, 3, "每卡一枚勾选 chip");
    fireEvent.click(chips[0]!); // c1
    fireEvent.click(chips[1]!); // c2（已在队列）
    fireEvent.click(chips[2]!); // c3
    fireEvent.click(screen.getByRole("button", { name: "入纸匣" }));
    const items = useQueue.getState().items;
    const keys = items.map((x) => `${x.source}:${x.id}`);
    assert.ok(keys.includes("x:c1"), "c1 入队（source=x）");
    assert.ok(keys.includes("x:c3"), "c3 入队（source=x）");
    assert.equal(items.filter((x) => x.key === "x:c2").length, 1, "已在队列的 c2 不重复（被跳过）");
    const c1 = items.find((x) => x.key === "x:c1")!;
    assert.equal(c1.source, "x");
    assert.equal(c1.kind, "vault", "入纸匣 kind=vault");
    // 选择模式自动退出
    await waitFor(() => assert.equal(screen.queryByRole("toolbar", { name: "批量收藏" }), null, "入队后退出批量"));
  });

  it("顶栏反查画师页：在用关联回链 /user/{id}；仅忽略记录（M5 判据）不回链", async () => {
    // 在用关联：handle 命中 → 回画师页
    const linked: Record<string, XAssociation> = {
      "pixiv:2883985": { handle: "masara", origin: "manual", addedAt: 1, restId: X_USER.restId },
    };
    useSettings.setState({ xAssociations: linked });
    const calls: SourceCall[] = [];
    installFetch(SINGLE_PAGE, calls);
    renderPage();
    const back = await screen.findByRole("link", { name: "回画师页" });
    assert.equal(back.getAttribute("href"), "/user/2883985");

    // 仅忽略记录：handle ∈ 自己的 ignoredHandles → 只存忽略记忆，不当关联
    cleanup();
    useSettings.setState({
      xAssociations: { "pixiv:111": { handle: "masara", origin: "auto", addedAt: 1, ignoredHandles: ["masara"] } },
    });
    const calls2: SourceCall[] = [];
    installFetch(SINGLE_PAGE, calls2);
    renderPage();
    assert.ok(await screen.findByText("推文c1"), "页面照常渲染");
    assert.equal(screen.queryByRole("link", { name: "回画师页" }), null, "仅忽略记录不回链");
  });
});
