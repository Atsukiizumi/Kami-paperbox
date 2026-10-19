/**
 * useCrossfade 测试（dom 垫片 + node:test 假时钟）。
 *
 * 作用：锁 setTimeout 链推进、暂停三条件里的 document.hidden / 滚出视口、
 *      帧数不足两帧不起表、动效总开关（motionEnabled）锁首帧、
 *      下一帧预载走 warmMedia 代理 URL、卸载清理观察器与监听器。
 * 环境垫片：../../test/dom.ts 必须最先引入。
 */
import "../../test/dom.ts";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useCrossfade } from "./use-crossfade.ts";
import { useSettings } from "@/lib/store";
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

describe("useCrossfade（案头交叉淡换）", () => {
  beforeEach(() => {
    cleanup();
    FakeIO.instances = [];
  });

  afterEach(() => {
    cleanup();
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    delete (globalThis as { Image?: unknown }).Image;
    delete (document as { hidden?: boolean }).hidden;
    useSettings.setState({ motionEnabled: true });
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

  it("动效开关关闭锁首帧；打开后恢复轮播", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    useSettings.setState({ motionEnabled: false });
    render(<CrossfadeFixture frames={FRAMES2} />);
    act(() => t.mock.timers.tick(24000));
    assert.equal(slotText(), "a#0", "动效关闭期间不起定时器");
    act(() => useSettings.setState({ motionEnabled: true }));
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
    assert.equal(docListeners.get("visibilitychange")?.size ?? 0, 0, "visibilitychange 监听器全部移除");

    doc.addEventListener = origAdd;
    doc.removeEventListener = origRemove;
    timers.clearTimeout = origClear;
  });
});
