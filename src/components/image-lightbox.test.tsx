/**
 * 灯箱加载态测试（dom 垫片 + jsdom）。
 *
 * 作用：锁「主图加载中显示转圈、onLoad 后淡入、换页按 src 重挂回到转圈」
 *      ——修复「多 p 切换停留在上一张」的回归。
 * 环境垫片：../test/dom.ts 必须最先引入。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ImageLightbox, type LightboxItem } from "./image-lightbox.tsx";

const ITEMS: LightboxItem[] = [
  { src: "/api/media?u=page0-original", alt: "第0页" },
  { src: "/api/media?u=page1-original", alt: "第1页" },
];

/** 灯箱经 createPortal 渲染到 document.body，不在 RTL container 里——查 body。 */
function stageImg(): HTMLImageElement {
  const img = document.body.querySelector('img[alt^="第"]');
  assert.ok(img, "主图应存在");
  return img as HTMLImageElement;
}

describe("ImageLightbox 加载态", () => {
  beforeEach(() => {
    cleanup();
    // jsdom 未实现 scrollIntoView——缩略图条居中滚动 effect 会踩到
    Element.prototype.scrollIntoView ??= () => {};
  });

  it("加载中显示转圈，onLoad 后转圈消失、图片淡入", () => {
    render(<ImageLightbox items={ITEMS} index={0} open onClose={() => {}} onIndex={() => {}} />);
    assert.ok(document.body.querySelector('[aria-label="加载中"]'), "加载中应有转圈");
    const img = stageImg();
    assert.match(img.className, /opacity-0/, "未加载完不显示位图");
    fireEvent.load(img);
    assert.equal(document.body.querySelector('[aria-label="加载中"]'), null, "load 后转圈消失");
    assert.match(stageImg().className, /opacity-100/, "load 后淡入");
  });

  it("换页按 src 重挂：回到加载态，旧图立即消失", () => {
    const { rerender } = render(
      <ImageLightbox items={ITEMS} index={0} open onClose={() => {}} onIndex={() => {}} />,
    );
    fireEvent.load(stageImg());
    rerender(<ImageLightbox items={ITEMS} index={1} open onClose={() => {}} onIndex={() => {}} />);
    assert.ok(document.body.querySelector('[aria-label="加载中"]'), "换页后回到加载态");
    const img = stageImg();
    assert.equal(img.getAttribute("src"), "/api/media?u=page1-original", "主图已是新页");
    assert.match(img.className, /opacity-0/, "新页未加载完不显示（不会停留在上一张）");
  });

  it("onError 显示失败文案而不是转圈", () => {
    render(<ImageLightbox items={ITEMS} index={0} open onClose={() => {}} onIndex={() => {}} />);
    fireEvent.error(stageImg());
    assert.equal(document.body.querySelector('[aria-label="加载中"]'), null);
    assert.ok(document.body.textContent.includes("图片加载失败"));
  });
});
