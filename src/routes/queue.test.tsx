/**
 * 队列页组件测试（P2-b，design §3.1）。
 *
 * 作用：锁「失败分类聚合条」「判死项不回炉」「重试 patch 五字段集」「按钮边界」
 *      四条 UI 接线；点击后的异步链路不设断言。
 * 环境垫片：../test/dom.ts 必须最先引入。fetch 桩必须 200 + `{}`——loadWork 判
 *      `r.op !== "pixivIllust"` 一拍抛「返回类型异常」判死（queue-runner.ts:40 +
 *      queue-retry.ts:11），无退避；桩返回非 ok 会走「请求失败」network 类真退避
 *      4s/8s 拖死测试。时序备案：runQueue 的同步前缀（pumpWave→processOne 首行
 *      patch）会在 click 返回前把 queued 项取走改 running——「patch 五字段集」
 *      用 store 订阅快照锁（状态确实路过 queued），终态 status 断言相应放宽。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueuePage } from "./queue.tsx";
import { useQueue } from "@/lib/store";
import type { QueueItem } from "@/lib/types";

/** /api/source 一拍判死桩；其余端点 404（QueuePage 渲染不取数）。 */
async function stubFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/source") && (init?.method ?? "GET") === "POST") {
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("not found", { status: 404 });
}
globalThis.fetch = stubFetch as typeof fetch;

function item(over: Partial<QueueItem> & Pick<QueueItem, "key" | "error">): QueueItem {
  return {
    source: "pixiv",
    id: over.key,
    title: `t-${over.key}`,
    author: "a",
    thumb: "",
    kind: "download",
    status: "error",
    progress: 1,
    total: 1,
    addedAt: 1,
    ...over,
  };
}

/** 订阅快照收集器：zustand set 同步通知，click 后逐帧翻查 queued 态五字段。 */
function snapItems(): { snaps: QueueItem[][]; unsub: () => void } {
  const snaps: QueueItem[][] = [];
  const unsub = useQueue.subscribe((s) => snaps.push(s.items.map((x) => ({ ...x }))));
  return { snaps, unsub };
}

function renderPage() {
  return render(<QueuePage />);
}

describe("队列页失败分类与批量重试（P2-b）", () => {
  beforeEach(() => {
    cleanup();
    useQueue.setState({ items: [] });
  });

  it("分类聚合：三类错误各一条，分类条逐类渲染 ×1", () => {
    useQueue.setState({
      items: [
        item({ key: "a", error: "上游返回（429）" }), // rate-limit 优先级最高
        item({ key: "b", error: "需要登录" }), // auth
        item({ key: "c", error: "网络异常" }), // network
      ],
    });
    renderPage();
    assert.ok(screen.getByText("上游限速 ×1"));
    assert.ok(screen.getByText("要登录 / 订阅 ×1"));
    assert.ok(screen.getByText("网络失败 ×1"));
    assert.ok(screen.getByText(/失败 3 项/));
  });

  it("判死不回炉：判死项字段原样；可重试项被 patch（queued 态快照五字段集）", () => {
    const dead = item({ key: "dead", error: "需要登录", attempts: 2, progress: 1 });
    const live = item({ key: "live", error: "网络异常", attempts: 1, progress: 1 });
    useQueue.setState({ items: [dead, live] });
    const { snaps, unsub } = snapItems();
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /重试全部失败（1）/ }));

    // 判死项：status/error/字段原样，不被回炉（核心断言）
    const after = useQueue.getState().items;
    const deadAfter = after.find((x) => x.key === "dead")!;
    assert.equal(deadAfter.status, "error");
    assert.equal(deadAfter.error, "需要登录");
    assert.equal(deadAfter.attempts, 2);
    assert.equal(deadAfter.progress, 1);

    // 可重试项：patch 五字段集（queue.tsx:53）一个不少一个不多——在 queued 态
    // 快照上锁；终态 status 可能已被 runQueue 同步前缀取走改 running
    const queued = snaps.flat().find((x) => x.key === "live" && x.status === "queued");
    assert.ok(queued, "patch 后状态路过 queued");
    assert.equal(queued.error, undefined);
    assert.equal(queued.progress, 0);
    assert.equal(queued.attempts, 0);
    assert.equal(queued.nextRetryAt, undefined);
    unsub();
  });

  it("按钮边界：全部判死不渲染重试钮、渲染「N 项不可自动重试」；failed 为 0 整条分类条不渲染", () => {
    useQueue.setState({
      items: [item({ key: "d1", error: "需要登录" }), item({ key: "d2", error: "不存在" })],
    });
    renderPage();
    assert.equal(screen.queryByRole("button", { name: /重试全部失败/ }), null);
    assert.ok(screen.getByText(/2 项不可自动重试/));

    cleanup();
    useQueue.setState({ items: [item({ key: "ok", error: undefined, status: "done", progress: 1 })] });
    renderPage();
    assert.equal(screen.queryByText(/失败 \d+ 项/), null, "failed 为 0 分类条整条不渲染");
  });
});
