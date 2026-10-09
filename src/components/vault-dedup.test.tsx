/**
 * 查重「删除这张」。
 *
 * 作用：锁住服务端回 HTTP 200 且 ok:false 时卡片还在；ok:true 时卡片消失并通知父级。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { VaultMeta } from "@/lib/types";
import { VaultDedup } from "./vault-dedup.tsx";

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

function meta(key: string): VaultMeta {
  const cut = key.indexOf(":");
  return {
    key,
    source: key.slice(0, cut) as VaultMeta["source"],
    id: key.slice(cut + 1),
    title: `t-${key}`,
    author: "画师",
    authorId: "1",
    tags: [],
    pageCount: 1,
    savedAt: 1,
    bytes: 0,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("查重删除这张", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  function stubFetch(deletedOk: boolean) {
    installIdb();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? "GET";
      if (url.includes("/api/vault/dedup") && method === "GET") {
        return json({
          ok: true,
          groups: [{ keys: ["pixiv:1", "pixiv:2"], maxDistance: 2 }],
          hashed: 2,
          total: 2,
        });
      }
      if (url.startsWith("/api/vault") && method === "DELETE") {
        return json({ ok: deletedOk, deleted: deletedOk });
      }
      return new Response("no", { status: 404 });
    }) as typeof fetch;
  }

  it("服务端 ok:false（HTTP 200）时卡片还在，也不通知父级", async () => {
    stubFetch(false);
    let changed = 0;
    render(<VaultDedup items={[meta("pixiv:1"), meta("pixiv:2")]} onChanged={() => { changed += 1; }} />);
    const buttons = await waitFor(() => screen.getAllByRole("button", { name: "删除这张" }));
    assert.equal(buttons.length, 2);
    fireEvent.click(buttons[0]!);
    await waitFor(() => {
      assert.match(document.body.textContent ?? "", /没放进纸篓，这条还在/);
    });
    assert.equal(screen.getAllByRole("button", { name: "删除这张" }).length, 2);
    assert.equal(changed, 0);
    assert.match(document.body.textContent ?? "", /t-pixiv:1/);
    assert.match(document.body.textContent ?? "", /t-pixiv:2/);
  });

  it("放进纸篓后这张从组里消失，并通知父级刷新", async () => {
    stubFetch(true);
    let changed = 0;
    render(<VaultDedup items={[meta("pixiv:1"), meta("pixiv:2")]} onChanged={() => { changed += 1; }} />);
    const buttons = await waitFor(() => screen.getAllByRole("button", { name: "删除这张" }));
    fireEvent.click(buttons[0]!);
    await waitFor(() => {
      assert.match(document.body.textContent ?? "", /没有发现重复/);
    });
    assert.equal(screen.queryAllByRole("button", { name: "删除这张" }).length, 0);
    assert.equal(changed, 1);
  });
});
