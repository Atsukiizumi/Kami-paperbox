/**
 * useViewportActive 测试（dom 垫片 + node:test）。
 *
 * 作用：锁「document.hidden 翻转 → active 翻转」「容器滚出视口 / 滚回 → active
 *      翻转」「容器迟到挂载（报纸数据到了才渲染的形态）观察器补挂」与
 *      「卸载清理观察器与 visibilitychange 监听器」；无 IntersectionObserver
 *      的环境当作可见。
 * 环境垫片：../../test/dom.ts 必须最先引入。
 */
import "../../test/dom.ts";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useViewportActive } from "./use-viewport-active.ts";

function ActiveFixture({ renderBox = true }: { renderBox?: boolean }) {
  const { ref, active } = useViewportActive<HTMLDivElement>();
  return (
    <div>
      {renderBox ? <div ref={ref} data-testid="box" /> : null}
      <p data-testid="state">{active ? "active" : "paused"}</p>
    </div>
  );
}

function stateText(): string {
  return screen.getByTestId("state").textContent ?? "";
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

describe("useViewportActive（案头动效视口活跃）", () => {
  beforeEach(() => {
    cleanup();
    FakeIO.instances = [];
  });

  afterEach(() => {
    cleanup();
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    delete (document as { hidden?: boolean }).hidden;
  });

  it("没有 IntersectionObserver 的环境当作可见", () => {
    render(<ActiveFixture />);
    assert.equal(stateText(), "active");
    assert.equal(FakeIO.instances.length, 0);
  });

  it("挂载时已 hidden → 不活跃；翻回可见续播", () => {
    let hidden = true;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    render(<ActiveFixture />);
    act(() => {
      document.dispatchEvent(new window.Event("visibilitychange"));
    });
    assert.equal(stateText(), "paused");
    hidden = false;
    act(() => {
      document.dispatchEvent(new window.Event("visibilitychange"));
    });
    assert.equal(stateText(), "active");
  });

  it("容器滚出视口 → 不活跃；滚回续播", () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;
    render(<ActiveFixture />);
    const io = FakeIO.instances[0];
    assert.ok(io, "容器应被观察");
    act(() => io.fire(false));
    assert.equal(stateText(), "paused");
    act(() => io.fire(true));
    assert.equal(stateText(), "active");
  });

  it("容器迟到挂载（数据到了才渲染）→ 观察器补挂，离屏同样暂停", () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;
    const view = render(<ActiveFixture renderBox={false} />);
    assert.equal(FakeIO.instances.length, 0, "容器未挂载不观察");
    view.rerender(<ActiveFixture renderBox />);
    const io = FakeIO.instances[0];
    assert.ok(io, "容器落地后补挂观察器");
    act(() => io.fire(false));
    assert.equal(stateText(), "paused");
  });

  it("卸载清理观察器与 visibilitychange 监听器", () => {
    const docListeners = new Set<() => void>();
    const doc = document as unknown as {
      addEventListener: (type: string, cb: () => void) => void;
      removeEventListener: (type: string, cb: () => void) => void;
    };
    const origAdd = document.addEventListener.bind(document) as (type: string, cb: () => void) => void;
    const origRemove = document.removeEventListener.bind(
      document,
    ) as (type: string, cb: () => void) => void;
    doc.addEventListener = (type, cb) => {
      if (type === "visibilitychange") docListeners.add(cb);
      origAdd(type, cb);
    };
    doc.removeEventListener = (type, cb) => {
      docListeners.delete(cb);
      origRemove(type, cb);
    };

    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;
    const { unmount } = render(<ActiveFixture />);
    assert.ok(FakeIO.instances.length > 0);
    unmount();

    assert.ok(FakeIO.instances.every((io) => io.disconnected), "IntersectionObserver 全部断开");
    assert.equal(docListeners.size, 0, "visibilitychange 监听器全部移除");

    doc.addEventListener = origAdd;
    doc.removeEventListener = origRemove;
  });
});
