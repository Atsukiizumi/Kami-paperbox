/**
 * node:test 的浏览器环境垫片（RTL 组件测试用，M9）。
 *
 * 用法：组件测试文件第一行 `import "../test/dom.ts";`——把 jsdom 装进
 * globalThis，RTL 才能 render。为什么不用 jsdom 全局配置文件：node --test
 * 按 worker 隔离，每个测试文件显式引入最省心。
 */
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

const g = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
if (typeof g.document === "undefined") {
  g.document = dom.window.document;
}
for (const key of ["window", "navigator", "HTMLElement", "Element", "Node", "NodeFilter", "TreeWalker", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement", "HTMLFormElement", "HTMLSelectElement", "Document", "DocumentFragment", "ShadowRoot", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "localStorage", "CustomEvent", "Event", "ResizeObserver", "MutationObserver", "matchMedia"] as const) {
  const existing = (g as Record<string, unknown>)[key];
  if (existing === undefined || key === "localStorage") {
    const fromDom = (dom.window as unknown as Record<string, unknown>)[key];
    if (fromDom !== undefined) (g as Record<string, unknown>)[key] = fromDom;
  }
}
g.IS_REACT_ACT_ENVIRONMENT = true;

// Node 自带 Event / CustomEvent 构造器，但 jsdom 的 EventTarget 只认 jsdom 事件实例。
// Radix（Dialog 的 DismissableLayer / FocusScope）直接 new 全局构造器再 dispatch 到
// document，事件必须统一成 jsdom 版本，否则 dialog 一挂载就整树崩（首次测 Radix
// Dialog/Select 时发现）。
for (const key of ["Event", "CustomEvent", "UIEvent", "MouseEvent", "KeyboardEvent", "FocusEvent", "PointerEvent"] as const) {
  const fromDom = (dom.window as unknown as Record<string, unknown>)[key];
  if (fromDom !== undefined) (g as Record<string, unknown>)[key] = fromDom;
}

// jsdom 不实现 scrollIntoView（键盘流焦点滚动用）；给空实现即可
if (typeof g.HTMLElement !== "undefined" && !g.HTMLElement.prototype.scrollIntoView) {
  g.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
}

// jsdom 没有实现 matchMedia / ResizeObserver，Radix 系组件会探测它们
if (typeof g.matchMedia !== "function") {
  (g as Record<string, unknown>).matchMedia = () => ({
    matches: false,
    media: "",
    onchange: null,
    addListener: () => () => undefined,
    removeListener: () => undefined,
    addEventListener: () => () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}
if (typeof g.ResizeObserver === "undefined") {
  (g as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
// ProxiedImg / 卡片懒加载用 IntersectionObserver；jsdom 没有，给全触发的桩
if (typeof g.IntersectionObserver === "undefined") {
  (g as Record<string, unknown>).IntersectionObserver = class {
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds: ReadonlyArray<number> = [];
    observe(target: unknown) {
      // 立即报「已进入视口」：懒加载图在测试里同步挂载
      const cb = (this as unknown as { __cb?: (entries: unknown[]) => void }).__cb;
      cb?.([{ target, isIntersecting: true, intersectionRatio: 1 }]);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
}
