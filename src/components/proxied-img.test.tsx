/**
 * ProxiedImg 揭示与垫图行为测试（动效批 2026-10-25 · Task 3）。
 *
 * 作用：锁「短淡入、缓存命中不重播、换源不串台、高清失败保缩略图」。
 * 用法：node --import tsx --test src/components/proxied-img.test.tsx。
 * 为什么：jsdom 不加载真实图片——load/error 靠 dispatchEvent 驱动，
 *   内存热集合（warmThumbs）由组件自身维护，跨渲染复用真实路径。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanup, render, act } from "@testing-library/react";
import { ProxiedImg } from "./proxied-img.tsx";

// dom.ts 的 IntersectionObserver 桩不会回调；本文件装「立即进入视口」的真桩
// （ProxiedImg 靠 IO 决定是否挂 <img>），只影响本测试进程。
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

const THUMB = "https://study.invalid/t/a.jpg";
const HD = "https://study.invalid/t/a_hd.jpg";
const OTHER = "https://study.invalid/t/b.jpg";
const THIRD = "https://study.invalid/t/c.jpg";

function mediaSrc(url: string) {
  return `/api/media?u=${encodeURIComponent(url)}`;
}

function imgs(host: HTMLElement | Document = document) {
  return [...host.querySelectorAll("img")];
}

function fire(el: Element, type: "load" | "error") {
  el.dispatchEvent(new Event(type));
}

function firstRender(src: string) {
  const utils = render(<ProxiedImg src={src} alt="样张" fit="cover" />);
  return utils;
}

/** 先渲染一次并触发 load，把地址写进内存热集合，再卸载。 */
async function warm(src: string) {
  const utils = firstRender(src);
  act(() => fire(imgs(utils.container as unknown as HTMLElement)[0]!, "load"));
  await act(async () => {});
  utils.unmount();
}

test.afterEach(() => cleanup());

test("warm image is visible without replay", async () => {
  await warm(THUMB);
  const { container } = render(<ProxiedImg src={THUMB} alt="样张" fit="cover" />);
  const img = imgs(container as unknown as HTMLElement)[0]!;
  assert.equal(img.getAttribute("src"), mediaSrc(THUMB));
  assert.match(img.className, /opacity-100/);
  assert.doesNotMatch(img.className, /opacity-0/);
  // 无扫光骨架
  assert.equal(container.querySelector(".kami-shimmer"), null);
});

test("source changes before previous load completes keeps new source pending until its own load", async () => {
  // OTHER / THIRD 都未进热集合（THUMB 已被上一条暖掉，HD 留给后面的失败用例）：pending → pending 换源
  const { container, rerender } = firstRender(OTHER);
  const before = imgs(container as unknown as HTMLElement)[0]!;
  assert.match(before.className, /opacity-0/);

  rerender(<ProxiedImg src={THIRD} alt="样张" fit="cover" />);
  await act(async () => {});
  const after = imgs(container as unknown as HTMLElement);
  assert.equal(after.length, 1, "旧的 pending 元素不叠加");
  const img = after[0]!;
  assert.equal(img.getAttribute("src"), mediaSrc(THIRD));
  assert.match(img.className, /opacity-0/, "换源后未加载前不串台显示");

  act(() => fire(img, "load"));
  await act(async () => {});
  assert.match(imgs(container as unknown as HTMLElement)[0]!.className, /opacity-100/);
});

test("fallback remains visible when hd fails", async () => {
  await warm(THUMB);
  const { container, rerender } = render(
    <ProxiedImg src={HD} alt="样张" fit="cover" fallbackSrc={THUMB} />,
  );
  const host = container as unknown as HTMLElement;
  // 高清未就绪：垫图已显示（无扫光盖顶）
  const fallback = imgs(host).find((el) => el.getAttribute("src") === mediaSrc(THUMB));
  assert.ok(fallback, "垫图渲染在主图下");
  assert.equal(host.querySelector(".kami-shimmer"), null, "有垫图时不再扫光");

  // 四次重试全失败（400/800/1600ms 退避）→ failed：垫图保住，不露空白框
  for (let i = 0; i < 4; i += 1) {
    const main = imgs(host).find((el) => el.getAttribute("src") === mediaSrc(HD));
    if (!main) break;
    act(() => fire(main, "error"));
    await new Promise((r) => setTimeout(r, 450 * 2 ** i));
  }
  rerender(<ProxiedImg src={HD} alt="样张" fit="cover" fallbackSrc={THUMB} />);
  const kept = imgs(host).find((el) => el.getAttribute("src") === mediaSrc(THUMB));
  assert.ok(kept, "高清彻底失败后垫图仍在");
  assert.equal(imgs(host).some((el) => el.getAttribute("src") === mediaSrc(HD)), false, "失败的主图不再挂载");
});

test("fallback only renders when it is already warm (no extra lane request)", async () => {
  const { container } = render(
    <ProxiedImg src={HD} alt="样张" fit="cover" fallbackSrc={OTHER} />,
  );
  const host = container as unknown as HTMLElement;
  // OTHER 未进热集合：不渲染垫图，走扫光占位
  assert.equal(imgs(host).some((el) => el.getAttribute("src") === mediaSrc(OTHER)), false);
  assert.ok(host.querySelector(".kami-shimmer"), "未热垫图不渲染，扫光照常");
});
