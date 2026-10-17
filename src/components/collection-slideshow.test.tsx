/**
 * 合集幻灯片测（dom 垫片 + jsdom + 假时钟）。
 *
 * 作用：锁幕列表纯函数（保序 / 滤无像素 / skipped）、预热当前+后两张、重挂不残留
 *      缓存、循环翻页与 Esc/空格、自动播放到点翻页与暂停停翻、卸载竞态守卫
 *      （晚到的 resolve 不得再 createObjectURL）、遮盖 blur 与中间点击揭示、
 *      skipped 常驻文案——design §4.3/§4.4 全列。
 * 环境垫片：../test/dom.ts 必须最先引入；blob URL 用 Node 原生 create/revoke，
 *      计数断言用 t.mock.method 打点（jsdom 不参与，<img src="blob:…"> 不取图）。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { CollectionSlideshow, slideshowSlides } from "./collection-slideshow.tsx";
import { useVeil } from "@/lib/veil";
import type { VaultMeta } from "@/lib/types";

// node:test 没有 RTL 依赖的全局 afterEach，自动清理不生效；只靠 beforeEach 的
// cleanup 会把最后一个测试的组件连着真实 setInterval 留在页面上——事件循环
// 永远不空，node --test 的子进程就退出不了。文件级 after 兜底。
after(() => cleanup());

function meta(i: number, extra: Partial<VaultMeta> = {}): VaultMeta {
  return {
    key: `pixiv:${9000 + i}`,
    source: "pixiv",
    id: String(9000 + i),
    title: `藏品${i}`,
    author: `画师${i}`,
    authorId: String(100 + i),
    tags: [],
    pageCount: 1,
    savedAt: 1_700_000_000_000 + i,
    bytes: 1000,
    ...extra,
  };
}

/** 立即解出假 Blob 的注入链；calls 顺带记录调用顺序（预热断言用）。 */
function okResolver(calls?: VaultMeta[]) {
  return (item: VaultMeta) => {
    calls?.push(item);
    return Promise.resolve(new Blob(["x"]));
  };
}

function slideshow(members: VaultMeta[], opts: { onClose?: () => void; resolveSlide?: (item: VaultMeta) => Promise<Blob | undefined> } = {}) {
  return render(
    <CollectionSlideshow
      name="测试合集"
      members={members}
      open
      onClose={opts.onClose ?? (() => {})}
      resolveSlide={opts.resolveSlide}
    />,
  );
}

/** 幕解析是异步的：act 空转一圈把微任务冲完，img / 失败文案才落位。 */
async function flush() {
  await act(async () => {});
}

function stageImg(): HTMLImageElement {
  const img = document.body.querySelector("img");
  assert.ok(img, "当前张 img 应存在");
  return img as HTMLImageElement;
}

describe("slideshowSlides（幕列表纯函数）", () => {
  it("保序输出，滤掉三处像素源都够不着的成员并计数", () => {
    const ok1 = meta(0);
    const ok2 = meta(1, { hasFile: true });
    const ok3 = meta(2, { relativePath: "a/b.jpg" });
    const bad1 = meta(3, { origin: "folder" });
    const bad2 = meta(4, { origin: "folder", hasFile: false });
    const { slides, skipped } = slideshowSlides([ok1, bad1, ok2, bad2, ok3]);
    assert.deepEqual(slides, [ok1, ok2, ok3], "保序滤除");
    assert.equal(skipped, 2);
  });

  it("空 members → 空 slides + skipped 0", () => {
    assert.deepEqual(slideshowSlides([]), { slides: [], skipped: 0 });
  });
});

describe("CollectionSlideshow 组件", () => {
  beforeEach(() => {
    cleanup();
    useVeil.setState({ veil: false });
  });

  it("打开渲染当前张，预热当前+后两张；翻页后补解第三张", async () => {
    const members = [meta(0), meta(1), meta(2), meta(3)];
    const calls: VaultMeta[] = [];
    slideshow(members, { resolveSlide: okResolver(calls) });
    await flush();
    assert.match(stageImg().getAttribute("src") ?? "", /^blob:/, "当前张已解出 blob URL");
    assert.deepEqual(calls, [members[0], members[1], members[2]], "预热 idx、idx+1、idx+2");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await flush();
    assert.deepEqual(calls, [members[0], members[1], members[2], members[3]], "到 idx 1 只补解 idx+2");
  });

  it("重挂不残留缓存：再开是全新实例，预热重新发起", async () => {
    const members = [meta(0), meta(1), meta(2)];
    const calls: VaultMeta[] = [];
    const first = slideshow(members, { resolveSlide: okResolver(calls) });
    await flush();
    assert.equal(calls.length, 3);
    act(() => {
      first.unmount();
    });
    slideshow(members, { resolveSlide: okResolver(calls) });
    await flush();
    assert.deepEqual(
      calls,
      [members[0], members[1], members[2], members[0], members[1], members[2]],
      "Map 缓存不跨挂载实例",
    );
  });

  it("键盘：←/→ 循环翻页，Esc 关闭，空格切播放", async () => {
    const members = [meta(0), meta(1), meta(2)];
    let closed = 0;
    slideshow(members, { onClose: () => (closed += 1), resolveSlide: okResolver() });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    assert.ok(document.body.textContent!.includes("3 / 3"), "首张左翻到末张");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    assert.ok(document.body.textContent!.includes("1 / 3"), "末张右翻回首张");
    fireEvent.keyDown(window, { key: " " });
    assert.ok(document.body.querySelector('[aria-label="播放"]'), "空格切到暂停态（控件钮变播放）");
    assert.equal(document.body.querySelector('[aria-label="暂停"]'), null);
    fireEvent.keyDown(window, { key: "Escape" });
    assert.equal(closed, 1, "Esc 关闭");
    // 预热的解析微任务要落在本测内，别漏到下一个测试里触发 act 外更新
    await flush();
  });

  it("自动播放：默认 5s 到点翻页、末张循环；暂停后推进不再翻", async (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    slideshow([meta(0), meta(1), meta(2)], { resolveSlide: okResolver() });
    await flush();
    assert.ok(document.body.textContent!.includes("1 / 3"));
    await act(async () => {
      t.mock.timers.tick(5000);
    });
    assert.ok(document.body.textContent!.includes("2 / 3"), "到点翻页");
    await act(async () => {
      t.mock.timers.tick(5000);
    });
    await act(async () => {
      t.mock.timers.tick(5000);
    });
    assert.ok(document.body.textContent!.includes("1 / 3"), "末张循环回首张");
    fireEvent.click(document.body.querySelector('[aria-label="暂停"]')!);
    await act(async () => {
      t.mock.timers.tick(20000);
    });
    assert.ok(document.body.textContent!.includes("1 / 3"), "暂停后推进不再翻页");
  });

  it("卸载竞态：unmount 后晚到的 resolve 不再 createObjectURL（无人 revoke 的泄漏）", async (t) => {
    const members = [meta(0), meta(1), meta(2)];
    const gates: Array<(b: Blob | undefined) => void> = [];
    const create = t.mock.method(URL, "createObjectURL", () => "blob:mocked");
    const { unmount } = slideshow(members, {
      resolveSlide: (item) =>
        new Promise<Blob | undefined>((res) => {
          void item;
          gates.push(res);
        }),
    });
    assert.equal(gates.length, 3, "预热三张都发起、都还挂着");
    const before = create.mock.callCount();
    act(() => {
      unmount();
    });
    for (const g of gates) g(new Blob(["x"]));
    await flush();
    assert.equal(create.mock.callCount(), before, "mounted 守卫必须在 createObjectURL 之前");
  });

  it("卸载统一 revoke：访问过的幕 URL 全收，挂载期间不逐页 revoke", async (t) => {
    const revoke = t.mock.method(URL, "revokeObjectURL", () => {});
    const members = [meta(0), meta(1), meta(2)];
    const { unmount } = slideshow(members, { resolveSlide: okResolver() });
    await flush();
    // 翻过两张，三张都解析过
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await flush();
    assert.equal(revoke.mock.callCount(), 0, "挂载期间不逐页 revoke（断图会让回看闪碎图）");
    act(() => {
      unmount();
    });
    assert.equal(revoke.mock.callCount(), 3, "卸载全收");
  });

  it("遮盖：R-18 加 blur，中间点击揭示且揭示态跨翻页保留；普通张中间点击切播放", async () => {
    useVeil.setState({ veil: true });
    slideshow([meta(0, { xRestrict: 1 }), meta(1)], { resolveSlide: okResolver() });
    await flush();
    assert.match(stageImg().className, /blur-xl/, "遮盖开着 + R-18 → 模糊");
    fireEvent.click(document.body.querySelector("[data-middle]")!);
    assert.doesNotMatch(stageImg().className, /blur-xl/, "中间点击揭示本张");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    assert.doesNotMatch(stageImg().className, /blur-xl/, "普通张不遮");
    fireEvent.click(document.body.querySelector("[data-middle]")!);
    assert.ok(document.body.querySelector('[aria-label="播放"]'), "普通张中间点击切播放（不揭示不关）");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    assert.doesNotMatch(stageImg().className, /blur-xl/, "揭示态随翻页保留（Set 不清）");
  });

  it("skipped > 0 → 控件行常驻「已跳过 N 个无像素成员」，页码按幕数计", async () => {
    const noPixel = meta(9, { origin: "folder" });
    slideshow([meta(0), noPixel], { resolveSlide: okResolver() });
    await flush();
    assert.ok(document.body.textContent!.includes("已跳过 1 个无像素成员"));
    assert.ok(document.body.textContent!.includes("1 / 1"), "页码基于过滤后的幕数");
  });

  it("单张运行期解析失败 → 失败文案，放映不打断", async () => {
    const members = [meta(0), meta(1)];
    slideshow(members, {
      resolveSlide: (item) => Promise.resolve(item.key === members[0]!.key ? undefined : new Blob(["x"])),
    });
    await flush();
    assert.ok(document.body.textContent!.includes("图片加载失败"), "首张缺像素出失败文案");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await flush();
    assert.ok(stageImg(), "下一张照常显示，放映继续");
  });
});
