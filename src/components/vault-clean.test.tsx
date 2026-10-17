/**
 * 清理向导测（dom 垫片 + installIdb/fetch 桩，照 vault-dedup.test.tsx:86-110 模式）。
 *
 * 作用：锁「勾维度 → 只有命中项入列且默认全选」「取消一张合计相应减」「未读维度
 *      组件层对拍」「超 200 截断 + 尾部提示」「confirm 后逐条软删、DELETE 收到选中
 *      keys、onChanged 被调」「ok:false 的那条留列表、toast 走失败分支」——design §4.4。
 * 环境垫片：../test/dom.ts 必须最先引入；封面链走 installIdb 空库 + fetch 404 → 行画「无预览」。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { VaultCleanWizard } from "./vault-clean.tsx";
import type { HistoryEntry } from "@/lib/view-history";
import type { VaultMeta } from "@/lib/types";

const DAY = 86_400_000;

function meta(over: Partial<VaultMeta> & Pick<VaultMeta, "key">): VaultMeta {
  const cut = over.key.indexOf(":");
  return {
    source: over.key.slice(0, cut) as VaultMeta["source"],
    id: over.key.slice(cut + 1),
    title: `t-${over.key}`,
    author: "画师",
    authorId: "1",
    tags: [],
    pageCount: 1,
    savedAt: Date.now() - 400 * DAY,
    bytes: 100,
    ...over,
  };
}

function hist(id: string, viewedAt: number): HistoryEntry {
  return { source: "pixiv", id, title: `t-${id}`, author: "画师", authorId: "1", thumb: "", pageCount: 1, viewedAt };
}

function fulfill<T>(result: T) {
  const req = {
    result,
    error: null,
    onsuccess: null as null | (() => void),
    onerror: null as null | (() => void),
  };
  queueMicrotask(() => req.onsuccess?.());
  return req;
}

function installIdb() {
  const g = globalThis as unknown as { indexedDB?: unknown };
  g.indexedDB = {
    open() {
      const req = {
        result: undefined as unknown,
        onsuccess: null as null | (() => void),
        onerror: null as null | (() => void),
        onupgradeneeded: null as null | (() => void),
      };
      queueMicrotask(() => {
        req.result = {
          objectStoreNames: { contains: () => true },
          transaction() {
            const tx = {
              error: null,
              oncomplete: null as null | (() => void),
              onerror: null as null | (() => void),
              objectStore() {
                return {
                  indexNames: { contains: () => true },
                  get: () => fulfill(undefined),
                  getAll: () => fulfill([]),
                  put() {},
                  delete() {},
                };
              },
            };
            queueMicrotask(() => tx.oncomplete?.());
            return tx;
          },
        };
        req.onsuccess?.();
      });
      return req;
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** row 勾选框（aria-label 以「选中：」开头），与维度 chip 的 checkbox 区分开。 */
function rowBoxes(): HTMLInputElement[] {
  return [...document.body.querySelectorAll<HTMLInputElement>('input[aria-label^="选中："]')];
}

describe("清理向导", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  function stubFetch(opts: { failKeys?: string[]; deleted?: string[] } = {}) {
    installIdb();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/vault") && method === "DELETE") {
        const key = decodeURIComponent(new URL(url, "http://localhost").searchParams.get("key") ?? "");
        opts.deleted?.push(key);
        return json({ ok: !(opts.failKeys ?? []).includes(key) });
      }
      return new Response("no", { status: 404 }); // 封面链 / 其它请求一律不可达
    }) as typeof fetch;
  }

  it("勾「已被替换」→ 只有 replaced 成员入列且默认全选；取消一张 → 已选数相应减", () => {
    const items = [
      meta({ key: "pixiv:1", replaced: true, bytes: 300 }),
      meta({ key: "pixiv:2", replaced: true, bytes: 200 }),
      meta({ key: "pixiv:3" }),
    ];
    stubFetch();
    render(<VaultCleanWizard items={items} history={[]} onChanged={() => {}} />);
    fireEvent.click(screen.getByLabelText("已被替换"));
    const boxes = rowBoxes();
    assert.equal(boxes.length, 2, "只列 replaced 成员");
    assert.ok(boxes.every((b) => b.checked), "K-3 默认全选命中项");
    assert.match(document.body.textContent ?? "", /已选 2 张 · 合计 500 B/);
    fireEvent.click(boxes[0]!);
    assert.match(document.body.textContent ?? "", /已选 1 张 · 合计 200 B/, "取消一张合计相应减");
  });

  it("勾「超过 3 个月未读」+ 手造 history：命中符合纯函数口径（收藏后打开过的不入列）", () => {
    const now = Date.now();
    const items = [
      meta({ key: "pixiv:idle", savedAt: now - 200 * DAY }),
      meta({ key: "pixiv:opened", savedAt: now - 200 * DAY }),
    ];
    const history = [hist("opened", now - 10 * DAY)];
    stubFetch();
    render(<VaultCleanWizard items={items} history={history} onChanged={() => {}} />);
    fireEvent.click(screen.getByLabelText(/超过/));
    const boxes = rowBoxes();
    assert.deepEqual(
      boxes.map((b) => b.getAttribute("aria-label")),
      ["选中：t-pixiv:idle"],
      "10 天前打开过的从 viewedAt 起算，不满 3 个月不入列",
    );
    assert.match(document.body.textContent ?? "", /没打开过（或久到查不到）/, "无窗内条目文案不谎称从没打开过");
  });

  it("命中 > 200 → 只列 200 行 + 尾部截断提示", () => {
    const items = Array.from({ length: 201 }, (_, i) => meta({ key: `pixiv:${String(i).padStart(3, "0")}`, replaced: true }));
    stubFetch();
    render(<VaultCleanWizard items={items} history={[]} onChanged={() => {}} />);
    fireEvent.click(screen.getByLabelText("已被替换"));
    assert.equal(rowBoxes().length, 200, "本批只列前 200 条");
    assert.match(document.body.textContent ?? "", /命中 201 条，本批只列前 200 条（按当前排序），清完这批再开下一批。/);
  });

  it("confirm 后逐条软删：DELETE 收到选中 keys，onChanged 被调，成功走 toast.success", async (t) => {
    t.mock.method(window, "confirm", () => true);
    const success = t.mock.method(toast, "success", () => {});
    const error = t.mock.method(toast, "error", () => {});
    const deleted: string[] = [];
    stubFetch({ deleted });
    let changed = 0;
    // 模拟父级：onChanged 里按已删 keys 重发 items（= 真机的 refresh() 回填）
    const all = [meta({ key: "pixiv:1", replaced: true }), meta({ key: "pixiv:2", replaced: true })];
    const { rerender } = render(
      <VaultCleanWizard
        items={all}
        history={[]}
        onChanged={() => {
          changed += 1;
          rerender(
            <VaultCleanWizard
              items={all.filter((i) => !deleted.includes(i.key))}
              history={[]}
              onChanged={() => {
                changed += 1;
              }}
            />,
          );
        }}
      />,
    );
    fireEvent.click(screen.getByLabelText("已被替换"));
    fireEvent.click(screen.getByRole("button", { name: /移入纸篓/ }));
    await waitFor(() => assert.equal(changed, 1, "完成后通知父级刷新"));
    assert.deepEqual([...deleted].sort(), ["pixiv:1", "pixiv:2"], "DELETE 收到选中 keys");
    assert.equal(success.mock.callCount(), 1);
    assert.equal(error.mock.callCount(), 0);
    await waitFor(() => assert.equal(rowBoxes().length, 0, "刷新回填后已删条目从命中列表消失"));
  });

  it("DELETE ok:false 的那条留列表，toast 走失败分支（可重试）", async (t) => {
    t.mock.method(window, "confirm", () => true);
    const success = t.mock.method(toast, "success", () => {});
    const error = t.mock.method(toast, "error", () => {});
    stubFetch({ failKeys: ["pixiv:1"] });
    let changed = 0;
    const deletedOk = new Set<string>(["pixiv:2"]); // 只有 pixiv:2 软删成功
    const all = [meta({ key: "pixiv:1", replaced: true }), meta({ key: "pixiv:2", replaced: true })];
    const { rerender } = render(
      <VaultCleanWizard
        items={all}
        history={[]}
        onChanged={() => {
          changed += 1;
          rerender(
            <VaultCleanWizard
              items={all.filter((i) => !deletedOk.has(i.key))}
              history={[]}
              onChanged={() => {
                changed += 1;
              }}
            />,
          );
        }}
      />,
    );
    fireEvent.click(screen.getByLabelText("已被替换"));
    fireEvent.click(screen.getByRole("button", { name: /移入纸篓/ }));
    await waitFor(() =>
      assert.match(String(error.mock.calls[0]?.arguments[0] ?? ""), /移入纸篓 1 张，1 张失败/),
    );
    assert.equal(success.mock.callCount(), 0, "失败不报成功");
    assert.equal(changed, 1, "失败也刷新（失败条目经刷新仍在列表里）");
    await waitFor(() => {
      const labels = rowBoxes().map((b) => b.getAttribute("aria-label"));
      assert.deepEqual(labels, ["选中：t-pixiv:1"], "失败的留在列表里可重试");
    });
  });

  it("confirm 取消 → 一条都不删", async (t) => {
    t.mock.method(window, "confirm", () => false);
    const deleted: string[] = [];
    stubFetch({ deleted });
    let changed = 0;
    const items = [meta({ key: "pixiv:1", replaced: true })];
    render(<VaultCleanWizard items={items} history={[]} onChanged={() => { changed += 1; }} />);
    fireEvent.click(screen.getByLabelText("已被替换"));
    fireEvent.click(screen.getByRole("button", { name: /移入纸篓/ }));
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(deleted, []);
    assert.equal(changed, 0);
    assert.equal(rowBoxes().length, 1, "列表原样");
  });
});
