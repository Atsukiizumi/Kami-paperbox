/**
 * useCrossfade 测试（dom 垫片 + node:test 假时钟）。
 *
 * 作用：锁 setTimeout 链推进、暂停三条件里的 document.hidden / 滚出视口、
 *      帧数不足两帧不起表、prefers-reduced-motion 锁首帧（含变化监听）、
 *      下一帧预载走 warmMedia 代理 URL、卸载清理观察器与监听器。
 * 环境垫片：../../test/dom.ts 必须最先引入。
 */
import "../../test/dom.ts";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useCrossfade } from "./use-crossfade.ts";
import { mediaUrl } from "@/lib/utils";

type Frame = { id: string; url: string };

const FRAMES2: Frame[] = [
  { id: "a", url: "https://x/a.jpg" },
  { id: "b", url: "https://x/b.jpg" },
];

/** 稳定身份的 urlsOf（模块级），帧内容只看 url。 */
const frameUrls = (frame: Frame) => [frame.url];

function CrossfadeFixture({ frames, intervalMs = 8000 }: { frames: Frame[]; intervalMs?: number }) {
  const { frame, frameIndex, containerRef } = useCrossfade({ frames, intervalMs, urlsOf: frameUrls });
  return (
    <section ref={containerRef}>
      <p data-testid="slot">{frame ? `${frame.id}#${frameIndex}` : "none"}</p>
    </section>
  );
}

function slotText(): string {
  return screen.getByTestId("slot").textContent ?? "";
}

/** 可手动触发的 IntersectionObserver 替身。 */
class FakeIO {
  static instances: FakeIO[] = [];
  disconnected = false;
  constructor(
    private readonly cb: (entries: unknown[], io: FakeIO) => void,
  ) {
    FakeIO.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  fire(isIntersecting: boolean) {
    this.cb([{ isIntersecting }], this);
  }
}

/** 可控的 matchMedia 替身（matches 动态求值，记录 change 监听器）。 */
function stubMatchMedia(readMatches: () => boolean) {
  const listeners = new Set<() => void>();
  const media = (query: string) => ({
    get matches() {
      return readMatches() && query.includes("reduce");
    },
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: (_type: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_type: string, cb: () => void) => listeners.delete(cb),
    dispatchEvent: () => false,
  });
  const w = window as unknown as { matchMedia?: typeof media };
  w.matchMedia = media;
  return {
    listeners,
    notify: () => listeners.forEach((cb) => cb()),
  };
}

describe("useCrossfade（案头交叉淡换）", () => {
  beforeEach(() => {
    cleanup();
    FakeIO.instances = [];
  });

  afterEach(() => {
    cleanup();
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    delete (globalThis as { Image?: unknown }).Image;
    delete (window as { matchMedia?: unknown }).matchMedia;
    delete (document as { hidden?: boolean }).hidden;
  });

  it("两帧按整拍推进并环形回绕", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    render(<CrossfadeFixture frames={FRAMES2} />);
    assert.equal(slotText(), "a#0");
    act(() => t.mock.timers.tick(8000));
    assert.equal(slotText(), "b#1");
    act(() => t.mock.timers.tick(8000));
    assert.equal(slotText(), "a#0");
  });

  it("document.hidden 暂停；恢复后重新起算整拍，不追赶", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let hidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    render(<CrossfadeFixture frames={FRAMES2} />);
    act(() => t.mock.timers.tick(5000)); // 走到半拍
    hidden = true;
    act(() => document.dispatchEvent(new window.Event("visibilitychange")));
    act(() => t.mock.timers.tick(30000)); // 远超一整拍也不换（挂起的定时器已清）
    assert.equal(slotText(), "a#0");
    hidden = false;
    act(() => document.dispatchEvent(new window.Event("visibilitychange")));
    act(() => t.mock.timers.tick(7999)); // 恢复时刻起算，差 1ms 不换
    assert.equal(slotText(), "a#0");
    act(() => t.mock.timers.tick(1));
    assert.equal(slotText(), "b#1");
  });

  it("容器滚出视口暂停，滚回视口续播", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;
    render(<CrossfadeFixture frames={FRAMES2} />);
    const io = FakeIO.instances[0];
    assert.ok(io, "容器应被观察");
    act(() => io.fire(false));
    act(() => t.mock.timers.tick(30000));
    assert.equal(slotText(), "a#0");
    act(() => io.fire(true));
    act(() => t.mock.timers.tick(8000));
    assert.equal(slotText(), "b#1");
  });

  it("帧数不足两帧不起表；空帧安全返回 none", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { unmount } = render(<CrossfadeFixture frames={[{ id: "only", url: "https://x/o.jpg" }]} />);
    act(() => t.mock.timers.tick(60000));
    assert.equal(slotText(), "only#0");
    unmount();
    render(<CrossfadeFixture frames={[]} />);
    assert.equal(slotText(), "none");
  });

  it("prefers-reduced-motion 锁首帧；关掉后恢复轮播", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let reduced = true;
    const mq = stubMatchMedia(() => reduced);
    render(<CrossfadeFixture frames={FRAMES2} />);
    act(() => t.mock.timers.tick(24000));
    assert.equal(slotText(), "a#0", "减弱动态效果期间不起定时器");
    reduced = false;
    act(() => mq.notify());
    act(() => t.mock.timers.tick(8000));
    assert.equal(slotText(), "b#1");
  });

  it("下一帧预载走 warmMedia 的代理 URL", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const made: { src: string }[] = [];
    class FakeImage {
      src = "";
      decoding = "";
      fetchPriority = "";
      constructor() {
        made.push(this);
      }
      addEventListener() {}
      removeEventListener() {}
    }
    (globalThis as { Image?: unknown }).Image = FakeImage;
    render(<CrossfadeFixture frames={FRAMES2} />);
    // 挂载即预载下一帧 b（代理 URL 口径），当前帧 a 不预载
    assert.deepEqual(
      made.map((img) => img.src),
      [mediaUrl("https://x/b.jpg")],
    );
    act(() => t.mock.timers.tick(8000));
    // 换到 b 后，预载环形回绕的 a
    assert.deepEqual(
      made.map((img) => img.src),
      [mediaUrl("https://x/b.jpg"), mediaUrl("https://x/a.jpg")],
    );
  });

  it("卸载清理定时器、观察器与监听器", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const mq = stubMatchMedia(() => false);
    const docListeners = new Map<string, Set<() => void>>();
    const doc = document as unknown as {
      addEventListener: (type: string, cb: () => void) => void;
      removeEventListener: (type: string, cb: () => void) => void;
    };
    const origAdd = document.addEventListener.bind(document) as (type: string, cb: () => void) => void;
    const origRemove = document.removeEventListener.bind(
      document,
    ) as (type: string, cb: () => void) => void;
    doc.addEventListener = (type, cb) => {
      if (type === "visibilitychange") {
        const set = docListeners.get(type) ?? new Set<() => void>();
        set.add(cb);
        docListeners.set(type, set);
      }
      origAdd(type, cb);
    };
    doc.removeEventListener = (type, cb) => {
      docListeners.get(type)?.delete(cb);
      origRemove(type, cb);
    };
    let cleared = 0;
    const timers = globalThis as { clearTimeout: (id?: unknown) => void };
    const origClear = timers.clearTimeout.bind(globalThis);
    timers.clearTimeout = (id?: unknown) => {
      cleared += 1;
      origClear(id);
    };

    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;
    const { unmount } = render(<CrossfadeFixture frames={FRAMES2} />);
    assert.ok(FakeIO.instances.length > 0);
    unmount();

    assert.ok(cleared >= 1, "卸载时清掉挂起的定时器");
    assert.ok(FakeIO.instances.every((io) => io.disconnected), "IntersectionObserver 全部断开");
    assert.equal(mq.listeners.size, 0, "matchMedia change 监听器全部移除");
    assert.equal(docListeners.get("visibilitychange")?.size ?? 0, 0, "visibilitychange 监听器全部移除");

    doc.addEventListener = origAdd;
    doc.removeEventListener = origRemove;
    timers.clearTimeout = origClear;
  });
});
