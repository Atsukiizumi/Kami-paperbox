/**
 * CardMenu RTL：新增「复制 GIF」「在新标签页打开」两项（样板 card-caption.test.tsx）。
 *
 * 作用：条件渲染（有图才出复制项、新标签页打开恒在）+ 点击链——clipboard 桩观察
 *      纸匣直取 / 浏览态合成 / 降级下载，window.open 桩断参数，fetch 桩断「纸匣
 *      直取不重新合成」。
 */
import "../test/dom.ts";
import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { WorkCard, WorkDetail } from "@/lib/types";
import type { CardMenuPos } from "./card-menu";

// 组件链静态引入样式；node:test 不认 .css（与 card-caption.test 同款垫片）
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
}

const { CardMenu } = await import("./card-menu.tsx");

const stubRouter = {
  push: () => undefined,
  replace: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
  refresh: () => undefined,
};

function Harness({ work, inVault }: { work: WorkCard; inVault?: boolean }) {
  const [pos, setPos] = useState<CardMenuPos | null>({ x: 10, y: 10 });
  return (
    <AppRouterContext.Provider value={stubRouter as never}>
      <CardMenu work={work} pos={pos} inVault={inVault} onClose={() => setPos(null)} onQueue={() => {}} />
    </AppRouterContext.Provider>
  );
}

function work(over: Partial<WorkCard>): WorkCard {
  return {
    source: "danbooru",
    id: "1",
    title: "图",
    author: "画师",
    authorId: "",
    thumb: "t.jpg",
    pageCount: 1,
    tags: [],
    ...over,
  };
}

class FakeClipboardItem {
  items: Record<string, Blob>;
  constructor(items: Record<string, Blob>) {
    this.items = items;
  }
}

function stubClipboard(write?: (items: FakeClipboardItem[]) => Promise<void>): FakeClipboardItem[][] {
  const written: FakeClipboardItem[][] = [];
  // 桩装 globalThis.navigator：dom.ts 不覆盖 node 22 自带的全局 navigator，
  // 组件链（copy-image）看到的是它而不是 window.navigator
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: {
      write: async (items: FakeClipboardItem[]) => {
        written.push(items);
        await write?.(items);
      },
    },
    configurable: true,
  });
  return written;
}

/** 最小 IDB 桩：只够 vault.ts 的 openDb → blobs.get(`${key}#${page}`) 走通。 */
function stubVaultIDB(blob: Blob | undefined) {
  const getReq = {
    onsuccess: null as null | (() => void),
    onerror: null as null | (() => void),
    result: blob,
  };
  const openReq = {
    onupgradeneeded: null as null | (() => void),
    onsuccess: null as null | (() => void),
    onerror: null as null | (() => void),
    result: {
      objectStoreNames: { contains: () => true },
      indexNames: { contains: () => false },
      transaction: () => ({
        objectStore: () => ({
          get: () => {
            queueMicrotask(() => getReq.onsuccess?.());
            return getReq;
          },
        }),
      }),
    },
  };
  (globalThis as unknown as Record<string, unknown>).indexedDB = {
    open: () => {
      queueMicrotask(() => openReq.onsuccess?.());
      return openReq;
    },
  };
}

function stubFetch(handler: (url: string) => unknown): string[] {
  const calls: string[] = [];
  (globalThis as unknown as Record<string, unknown>).fetch = async (url: string | URL) => {
    calls.push(String(url));
    return handler(String(url));
  };
  return calls;
}

const BOORU_DETAIL = {
  source: "danbooru",
  id: "5",
  title: "静态图",
  author: "画师",
  authorId: "",
  thumb: "t.jpg",
  pageCount: 1,
  tags: [],
  description: "",
  pages: [{ thumb: "t.jpg", regular: "https://x/5.jpg", original: "https://x/5.jpg", name: "5.jpg" }],
} as unknown as WorkDetail;

describe("CardMenu 复制 GIF / 新标签页打开", () => {
  beforeEach(() => {
    cleanup();
    Object.defineProperty(globalThis, "ClipboardItem", {
      value: FakeClipboardItem,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    delete (globalThis.navigator as unknown as { clipboard?: unknown }).clipboard;
    delete (globalThis as unknown as Record<string, unknown>).indexedDB;
    delete (globalThis as unknown as Record<string, unknown>).fetch;
    delete (window as unknown as Record<string, unknown>).open;
    Reflect.deleteProperty(globalThis, "ClipboardItem");
    cleanup();
  });

  it("条件渲染：有图作品两项齐（静态图也放宽出复制项）；无图作品复制项不出、新标签页打开仍在", () => {
    const { unmount } = render(<Harness work={work({})} />);
    assert.ok(screen.getByRole("menuitem", { name: "复制 GIF" }));
    assert.ok(screen.getByRole("menuitem", { name: "在新标签页打开" }));
    unmount();

    render(<Harness work={work({ thumb: "" })} />);
    assert.equal(screen.queryByRole("menuitem", { name: "复制 GIF" }), null);
    assert.ok(screen.getByRole("menuitem", { name: "在新标签页打开" }), "R6：全部作品可用");
  });

  it("点击「在新标签页打开」：window.open 带 noopener 打详情页，菜单关闭", async () => {
    const opened: string[][] = [];
    Object.defineProperty(window, "open", {
      value: (url: string, target: string, features: string) => {
        opened.push([url, target, features]);
        return null;
      },
      configurable: true,
    });
    render(<Harness work={work({})} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "在新标签页打开" }));
    assert.deepEqual(opened, [["/work/danbooru/1", "_blank", "noopener,noreferrer"]]);
    await waitFor(() => assert.equal(screen.queryByRole("menuitem", { name: "在新标签页打开" }), null));
  });

  it("纸匣 GIF 直取：getVaultBlob 第 0 页写剪贴板 image/gif，不重新合成（fetch 零调用）", async () => {
    const written = stubClipboard(async () => undefined);
    stubVaultIDB(new Blob([new Uint8Array([0x47, 0x49, 0x46])], { type: "image/gif" }));
    const fetchCalls = stubFetch(() => {
      throw new Error("纸匣直取不应走网络");
    });
    render(<Harness work={work({ source: "pixiv", illustType: 2 })} inVault />);
    fireEvent.click(screen.getByRole("menuitem", { name: "复制 GIF" }));
    await waitFor(() => assert.equal(written.length, 1));
    assert.deepEqual(Object.keys(written[0]![0]!.items), ["image/gif"]);
    assert.equal(fetchCalls.length, 0);
    await waitFor(() => assert.equal(screen.queryByRole("menuitem", { name: "复制 GIF" }), null));
  });

  it("浏览态合成：loadWork → collectWorkFiles 取页图，clipboard.write 收 image/jpeg", async () => {
    const written = stubClipboard(async () => undefined);
    stubFetch((url) =>
      url.startsWith("/api/source")
        ? { ok: true, json: async () => ({ op: "booruPost", work: BOORU_DETAIL }) }
        : { ok: true, blob: async () => new Blob(["jpeg-bytes"], { type: "image/jpeg" }) },
    );
    render(<Harness work={work({ id: "5" })} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "复制 GIF" }));
    await waitFor(() => assert.equal(written.length, 1));
    assert.deepEqual(Object.keys(written[0]![0]!.items), ["image/jpeg"]);
  });

  it("降级：写剪贴板被拒 → downloadBlob 落下载文件（anchor click），不 throw", async () => {
    stubClipboard(async () => {
      throw new Error("NotAllowedError");
    });
    stubVaultIDB(new Blob([new Uint8Array([1])], { type: "image/gif" }));
    let clicks = 0;
    // dom.ts 只搬 HTMLElement 系基类，HTMLAnchorElement 要从 window 取
    const proto = window.HTMLAnchorElement.prototype as unknown as { click: () => void };
    const origClick = proto.click;
    proto.click = function click() {
      clicks += 1;
    };
    try {
      render(<Harness work={work({})} inVault />);
      fireEvent.click(screen.getByRole("menuitem", { name: "复制 GIF" }));
      await waitFor(() => assert.equal(clicks, 1));
    } finally {
      proto.click = origClick;
    }
  });
});
