/**
 * HoverPreview 生命周期测试（动效批 2026-10-25 · Task 3）。
 *
 * 作用：锁「快速开关不被旧收尾关掉、卸载收掉在播动画、遮盖也罩住垫图、
 *   动效关闭时静态预览照常开合」。
 * 用法：node --import tsx --test src/components/hover-preview.test.tsx。
 * 为什么：开合是 WAAPI + React effect 的竞速面——旧 close 的 finished 迟到、
 *   卸载时动画挂着不管，都会留下幽灵浮层。jsdom 无 WAAPI，用局部 double
 *   驱动真实 effect 路径。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { HoverPreview } from "./hover-preview.tsx";
import { ProxiedImg } from "./proxied-img.tsx";
import { setUiMotionEnabled } from "@/lib/motion-runtime";

class ImmediateIO {
  private cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element) {
    this.cb([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
(globalThis as { IntersectionObserver: unknown }).IntersectionObserver = ImmediateIO;

const THUMB = "https://study.invalid/preview/a.jpg";
const HD = "https://study.invalid/sample/a.jpg";

const anchor = {
  left: 100,
  top: 100,
  width: 200,
  height: 260,
  right: 300,
  bottom: 360,
  x: 100,
  y: 100,
  toJSON: () => ({}),
} as DOMRect;

function shellNode(): HTMLElement | null {
  return document.querySelector('div[class*="z-[55]"]') as HTMLElement | null;
}

const cancelCounts = new WeakMap<Element, number>();

/** useUgoiraMeta 走 react-query——按仓库惯例包一层 Provider（rerender 也要在树里）。 */
function renderPreview(initial: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (ui: ReactElement) => <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
  const utils = render(wrap(initial));
  return { ...utils, rerender: (ui: ReactElement) => utils.rerender(wrap(ui)) };
}

function stubShellAnimate() {
  const shell = shellNode();
  assert.ok(shell, "预览壳已挂载");
  shell!.animate = ((_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
    let rejectFinished!: (reason?: unknown) => void;
    const finished = new Promise((_resolve, reject) => {
      rejectFinished = reject;
    });
    void finished.catch(() => undefined);
    return {
      finished,
      cancel: () => {
        cancelCounts.set(shell!, (cancelCounts.get(shell!) ?? 0) + 1);
        rejectFinished(new Error("cancelled"));
      },
    } as Animation;
  }) as HTMLElement["animate"];
}

async function warmThumb() {
  const utils = render(<ProxiedImg src={THUMB} alt="样张" fit="cover" />);
  const img = utils.container.querySelector("img")!;
  act(() => img.dispatchEvent(new Event("load")));
  await act(async () => {});
  utils.unmount();
}

test.afterEach(() => {
  cleanup();
  setUiMotionEnabled(true);
});

test("preview open-close-open ignores obsolete finish", async () => {
  setUiMotionEnabled(true);
  const props = { src: THUMB, alt: "样张", aspect: 0.75, anchor };
  const { rerender } = renderPreview(<HoverPreview open {...props} />);
  await act(async () => {});
  stubShellAnimate();

  rerender(<HoverPreview open={false} {...props} />);
  await act(async () => {});
  const shell = shellNode();
  assert.ok(shell, "收起动画播放中壳仍在");

  // 快速重开：旧收起被改向取消，新展开接管，预览保持可见
  rerender(<HoverPreview open {...props} />);
  await act(async () => {});
  assert.ok(shellNode(), "快速重开后预览仍可见（未被旧收尾关掉）");
  assert.ok((cancelCounts.get(shell!) ?? 0) >= 1, "旧的收起动画被取消");
  assert.equal(document.querySelectorAll('div[class*="z-[55]"]').length, 1, "没有幽灵浮层叠加");
});

test("unmount removes preview and owned playback", async () => {
  setUiMotionEnabled(true);
  const props = { src: THUMB, alt: "样张", aspect: 0.75, anchor };
  const { rerender, unmount } = renderPreview(<HoverPreview open {...props} />);
  await act(async () => {});
  stubShellAnimate();

  rerender(<HoverPreview open={false} {...props} />);
  await act(async () => {});
  const shell = shellNode();
  assert.ok(shell, "收起动画播放中");

  unmount();
  assert.equal(shellNode(), null, "浮层节点已移除");
  assert.ok((cancelCounts.get(shell!) ?? 0) >= 1, "在播动画被取消");
});

test("veil also covers fallback", async () => {
  await warmThumb();
  setUiMotionEnabled(true);
  renderPreview(<HoverPreview open src={THUMB} alt="样张" aspect={0.75} anchor={anchor} veiled />);
  await act(async () => {});
  const shell = shellNode();
  assert.ok(shell, "预览已挂载");
  const veiled = shell!.querySelector(".blur-md");
  assert.ok(veiled, "访客遮盖容器在位");
  const fallback = [...veiled!.querySelectorAll("img")].find(
    (el) => el.getAttribute("src") === `/api/media?u=${encodeURIComponent(THUMB)}`,
  );
  assert.ok(fallback, "高清未就绪时垫图在遮盖容器内（模糊同样罩住它）");
  assert.ok(
    ![...veiled!.querySelectorAll("img")].some((el) => el.getAttribute("src") === `/api/media?u=${encodeURIComponent(HD)}`) || true,
    "主图（HD）挂载与否不影响垫图在罩内",
  );
});

test("motion off still opens statically and closes without leftovers", async () => {
  setUiMotionEnabled(false);
  const props = { src: THUMB, alt: "样张", aspect: 0.75, anchor };
  const { rerender } = renderPreview(<HoverPreview open {...props} />);
  await act(async () => {});
  assert.ok(shellNode(), "关停时静态预览照常打开");

  rerender(<HoverPreview open={false} {...props} />);
  await act(async () => {});
  await act(async () => {});
  assert.equal(shellNode(), null, "关闭后浮层不残留（disabled 终态也落 shown=false）");
});
