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
for (const key of ["window", "navigator", "HTMLElement", "Element", "Node", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "localStorage", "CustomEvent", "Event", "ResizeObserver", "matchMedia"] as const) {
  const existing = (g as Record<string, unknown>)[key];
  if (existing === undefined || key === "localStorage") {
    const fromDom = (dom.window as unknown as Record<string, unknown>)[key];
    if (fromDom !== undefined) (g as Record<string, unknown>)[key] = fromDom;
  }
}
g.IS_REACT_ACT_ENVIRONMENT = true;

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
