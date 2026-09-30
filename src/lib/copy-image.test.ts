/**
 * copy-image 纯函数单测：入口判定（GIF/静态/无图）与剪贴板封装的降级不 throw。
 * 剪贴板桩装在 globalThis——node 的 navigator 是只读 getter，用 defineProperty 换入。
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { canCopyImage, copyImageToClipboard, isGifWork } from "./copy-image.ts";
import type { WorkCard, WorkDetail } from "./types.ts";

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

/** node 22 的 navigator 有全局实例但没有 clipboard——加 own 属性即可，测完删掉。 */
function installClipboard(write?: (items: unknown[]) => Promise<void>): Record<string, Blob>[] {
  const written: Record<string, Blob>[] = [];
  (globalThis.navigator as unknown as { clipboard: unknown }).clipboard = {
    write: async (items: unknown[]) => {
      written.push(...(items as FakeClipboardItem[]).map((item) => item.items));
      await write?.(items);
    },
  };
  return written;
}

class FakeClipboardItem {
  items: Record<string, Blob>;
  constructor(items: Record<string, Blob>) {
    this.items = items;
  }
}

function installClipboardItem() {
  Object.defineProperty(globalThis, "ClipboardItem", {
    value: FakeClipboardItem,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  delete (globalThis.navigator as unknown as { clipboard?: unknown }).clipboard;
  Reflect.deleteProperty(globalThis, "ClipboardItem");
});

describe("isGifWork 入口判定", () => {
  it("pixiv illustType===2 是 GIF；illustType 1 / booru 静态不是", () => {
    assert.equal(isGifWork(work({ source: "pixiv", illustType: 2 })), true);
    assert.equal(isGifWork(work({ source: "pixiv", illustType: 1 })), false);
    assert.equal(isGifWork(work({ source: "danbooru" })), false);
  });

  it("详情 ugoira 元数据即 GIF（illustType 缺省也认）", () => {
    const detail = { ...work({ source: "fanbox" }), ugoira: { src: "", frames: [] } } as unknown as WorkDetail;
    assert.equal(isGifWork(detail), true);
  });

  it("藏品/附件页 ext gif 认 GIF（页名或原图 URL 以 .gif 结尾）", () => {
    const gifPage = {
      ...work({ source: "fanbox" }),
      pages: [{ thumb: "", regular: "https://x/a.gif", original: "https://x/a.gif", name: "a.gif" }],
    } as unknown as WorkDetail;
    const jpgPage = {
      ...work({ source: "fanbox" }),
      pages: [{ thumb: "", regular: "https://x/a.jpg", original: "https://x/a.jpg", name: "a.jpg" }],
    } as unknown as WorkDetail;
    assert.equal(isGifWork(gifPage), true);
    assert.equal(isGifWork(jpgPage), false);
  });
});

describe("canCopyImage 决策 1 放宽口径", () => {
  it("有图即可（静态图也出项）；无图不出", () => {
    assert.equal(canCopyImage(work({ source: "danbooru" })), true);
    assert.equal(canCopyImage(work({ source: "pixiv", illustType: 2 })), true);
    assert.equal(canCopyImage(work({ thumb: "" })), false);
  });
});

describe("copyImageToClipboard 降级不 throw", () => {
  it("环境不支持（无 clipboard / 无 ClipboardItem）返回 false，不 throw", async () => {
    assert.equal(await copyImageToClipboard(new Blob(["x"], { type: "image/gif" })), false);
    installClipboardItem();
    assert.equal(await copyImageToClipboard(new Blob(["x"], { type: "image/gif" })), false);
  });

  it("写入成功返回 true；MIME 用 blob.type，可被显式 mime 参数覆盖", async () => {
    installClipboardItem();
    const written = installClipboard(async () => undefined);
    const gif = new Blob(["gif-bytes"], { type: "image/gif" });
    assert.equal(await copyImageToClipboard(gif), true);
    assert.deepEqual(Object.keys(written[0]!), ["image/gif"]);

    const raw = new Blob(["bytes"]);
    assert.equal(await copyImageToClipboard(raw, "image/png"), true);
    assert.deepEqual(Object.keys(written[1]!), ["image/png"]);

    assert.equal(await copyImageToClipboard(raw), true);
    assert.deepEqual(Object.keys(written[2]!), ["image/gif"], "blob 无 type 时缺省 image/gif");
  });

  it("write 拒绝（权限/失焦）返回 false，不 throw", async () => {
    installClipboardItem();
    installClipboard(async () => {
      throw new Error("NotAllowedError");
    });
    assert.equal(await copyImageToClipboard(new Blob(["x"], { type: "image/gif" })), false);
  });
});
