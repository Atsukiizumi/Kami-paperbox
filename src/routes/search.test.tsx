/**
 * 搜图页 vaultState 重置测（P2-b，design §4/§5 T4；RTL + fetch 桩，queue.test.tsx 样板）。
 *
 * 作用：锁「新一轮 run() 开头把上一轮纸匣命中清回 unavailable（换图重搜旧块先隐）」
 *      与「外站 error 路径不误染 vaultState（catch 只清 groups/error）」。
 * 环境垫片：../test/dom.ts 必须最先引入；prepareSearchImage 在 jsdom 无
 *      createImageBitmap 时原样返回 File；applyFile 的 URL.createObjectURL 用桩补。
 */
import "../test/dom.ts";
import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

// 组件链静态引入样式；node:test 不认 .css（card-menu.test 同款垫片）
registerHooks({
  load(url, context, nextLoad) {
    if (url.split("?")[0].endsWith(".css")) {
      return { format: "module", source: "export default {}", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { SearchPage } = await import("./search.tsx");

const stubRouter = {
  push: () => undefined,
  replace: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
  refresh: () => undefined,
};

function match(title: string) {
  return {
    key: `pixiv:${title}`,
    source: "pixiv" as const,
    id: title,
    title,
    author: "画师",
    pageCount: 1,
    bytes: 1,
    savedAt: 1,
    hasFile: false,
    distance: 1,
  };
}

type VaultReply = { ok: boolean; matches?: ReturnType<typeof match>[] };
type SearchReply = { ok: boolean; error?: string; groups?: unknown[] };

/** 桩：/api/vault/search-by-image 与 /api/reverse-search 各按脚本逐次出响应。 */
function installFetch(vaultScript: VaultReply[], searchScript: SearchReply[]) {
  let vaultCalls = 0;
  let searchCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/vault/search-by-image")) {
      const reply = vaultScript[Math.min(vaultCalls, vaultScript.length - 1)]!;
      vaultCalls += 1;
      return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/api/reverse-search")) {
      const reply = searchScript[Math.min(searchCalls, searchScript.length - 1)]!;
      searchCalls += 1;
      return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function searchFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

function renderPage() {
  const utils = render(
    <AppRouterContext.Provider value={stubRouter as never}>
      <SearchPage />
    </AppRouterContext.Provider>,
  );
  const input = utils.container.querySelector('input[type="file"]')!;
  return { input, ...utils };
}

async function runWith(input: Element, name: string) {
  fireEvent.change(input, { target: { files: [searchFile(name)] } });
  fireEvent.click(screen.getByRole("button", { name: "开始搜图" }));
}

describe("搜图页 vaultState 重置（P2-b）", () => {
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = globalThis.URL.createObjectURL;
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    globalThis.URL.createObjectURL = originalCreateObjectURL;
  });

  it("两轮 run：旧命中在新一轮开头清掉，不残留到换图重搜", async () => {
    installFetch([{ ok: true, matches: [match("旧命中")] }, { ok: false }], [{ ok: true, groups: [] }]);
    // jsdom 没有 createObjectURL：applyFile 的预览链要一拍桩
    globalThis.URL.createObjectURL = (() => "blob:stub") as typeof URL.createObjectURL;
    const { input } = renderPage();

    await runWith(input, "a.png");
    await waitFor(() => assert.ok(screen.getByText("旧命中"), "第一轮命中渲染纸匣块"));

    await runWith(input, "b.png");
    assert.equal(screen.queryByText("旧命中"), null, "新一轮 run() 开头即清，不等到回包");
  });

  it("外站 error 路径不误染 vaultState：错误条出现，纸匣命中原样保留", async () => {
    installFetch([{ ok: true, matches: [match("纸匣命中")] }], [{ ok: false, error: "被风控了" }]);
    globalThis.URL.createObjectURL = (() => "blob:stub") as typeof URL.createObjectURL;
    const { input } = renderPage();

    await runWith(input, "a.png");
    await waitFor(() => assert.ok(screen.getByText("被风控了")));
    await waitFor(() => assert.ok(screen.getByText("纸匣命中"), "catch 只清 groups/error，纸匣块不跟着消失"));
  });
});
