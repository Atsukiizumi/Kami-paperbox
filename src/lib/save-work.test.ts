/**
 * X1 多页并行下载：在飞上限 ≤6、结果顺序稳定、单页终败带页号。
 * fetch 打桩（可控延迟 + 峰值观测），不碰网络。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { collectWorkFiles } from "./save-work.ts";
import type { WorkDetail, WorkPage } from "./types.ts";

function pageOf(i: number): WorkPage {
  return { thumb: `t${i}.jpg`, regular: `r${i}.jpg`, original: `o${i}.jpg`, name: `p${i}.jpg` };
}

function workOf(n: number): WorkDetail {
  return {
    source: "pixiv",
    id: "1",
    title: "t",
    author: "a",
    authorId: "1",
    thumb: "",
    pageCount: n,
    tags: [],
    pages: Array.from({ length: n }, (_, i) => pageOf(i)),
    description: "",
  } as unknown as WorkDetail;
}

function stubFetch(opts: { delayMs?: number; failOn?: string } = {}) {
  const state = { inFlight: 0, peak: 0, calls: 0 };
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    state.calls += 1;
    state.inFlight += 1;
    state.peak = Math.max(state.peak, state.inFlight);
    await new Promise((r) => setTimeout(r, opts.delayMs ?? 20));
    state.inFlight -= 1;
    if (opts.failOn && url.includes(opts.failOn)) {
      return new Response("no", { status: 403 });
    }
    return new Response(new Blob(["x"], { type: "image/jpeg" }), { status: 200 });
  }) as typeof fetch;
  return { state, restore: () => (globalThis.fetch = original) };
}

test("多页并行：在飞峰值 >1（真并行）且顺序稳定、进度达总数", async () => {
  const stub = stubFetch({ delayMs: 30 });
  try {
    const progress: [number, number][] = [];
    const saved = await collectWorkFiles(workOf(8), { original: true, onProgress: (d, t) => progress.push([d, t]) });
    assert.equal(saved.length, 8);
    assert.deepEqual(
      saved.map((s) => s.page.name),
      Array.from({ length: 8 }, (_, i) => `p${i}.jpg`),
      "结果按索引回填，文件顺序不乱",
    );
    assert.ok(stub.state.peak > 1, `应有并行（峰值 ${stub.state.peak}）`);
    assert.ok(stub.state.peak <= 6, `同源在飞上限 6（实测峰值 ${stub.state.peak}）`);
    assert.equal(progress.at(-1)?.[1], 8);
    assert.equal(progress.length, 8, "每页完成各回调一次");
  } finally {
    stub.restore();
  }
});

test("单页终败：错误带页号（第 i/N 页），不吞其他页定位", async () => {
  const stub = stubFetch({ delayMs: 10, failOn: "o3" });
  try {
    await assert.rejects(
      collectWorkFiles(workOf(6), { original: true }),
      /第 4\/6 页：下载失败（403）/,
    );
  } finally {
    stub.restore();
  }
});
