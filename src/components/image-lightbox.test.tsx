/**
 * 灯箱测试（dom 垫片 + jsdom）。
 *
 * 作用：锁「主图加载中显示转圈、onLoad 后淡入、换页按 src 重挂回到转圈」
 *      （修复「多 p 切换停留在上一张」的回归），以及动效批 Task 5 的
 *      开合生命周期与手势分层行为。
 * 环境垫片：../test/dom.ts 必须最先引入。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ImageLightbox, type LightboxItem } from "./image-lightbox.tsx";
import { setUiMotionEnabled } from "@/lib/motion-runtime";

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

function dialog(): HTMLElement | null {
  return document.querySelector('[aria-label="大图预览"]');
}

type DialogAnim = { frames: Keyframe[]; options: KeyframeAnimationOptions };

/** 外层对话框的 WAAPI 桩：返回记录器（开合动画都发生在这里）。 */
function stubDialogAnimate() {
  const plays: DialogAnim[] = [];
  let rejectFinished!: (reason?: unknown) => void;
  const finished = new Promise((_resolve, reject) => {
    rejectFinished = reject;
  });
  void finished.catch(() => undefined);
  let resolveFinished!: () => void;
  const settle = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  const el = dialog() as HTMLElement;
  assert.ok(el, "对话框应挂载");
  el.animate = ((frames: Keyframe[], options: KeyframeAnimationOptions) => {
    plays.push({ frames, options });
    return {
      finished,
      cancel: () => rejectFinished(new Error("cancelled")),
      // 真实浏览器 finish() 会把动画收到终态并 resolve finished——
      // 运行时「关停跳终点」依赖它；桩里同步兑现。
      finish: () => resolveFinished(),
      commitStyles: () => {},
    } as Animation;
  }) as typeof el.animate;
  return { plays, settle, resolveFinished: () => resolveFinished() };
}

/** 指针事件：jsdom 没有 PointerEvent——用 MouseEvent 注入 pointerId 派发
 *  （React 合成事件只读事件对象上的属性，不校验构造器身份）。 */
function pointer(el: Element, type: string, opts: { pointerId: number; clientX: number; clientY: number; isPrimary?: boolean }) {
  const ev = new MouseEvent(type, { bubbles: true, clientX: opts.clientX, clientY: opts.clientY });
  Object.defineProperty(ev, "pointerId", { value: opts.pointerId });
  Object.defineProperty(ev, "isPrimary", { value: opts.isPrimary ?? true });
  Object.defineProperty(ev, "pointerType", { value: "touch" });
  el.dispatchEvent(ev);
}

/** 内层变换容器：找带 translate(...) transform 的直接子层。 */
function transformLayer(): HTMLElement | null {
  const stage = dialog()?.querySelector(".overflow-hidden") as HTMLElement | null;
  return (stage?.firstElementChild as HTMLElement) ?? null;
}

describe("ImageLightbox 加载态", () => {
  beforeEach(() => {
    cleanup();
    setUiMotionEnabled(true);
    // dom.ts 已给 scrollIntoView 装过 no-op；这里覆写成记录器（参数可供断言）
    HTMLElement.prototype.scrollIntoView = function scrollIntoViewStub(opts?: ScrollIntoViewOptions) {
      (document as unknown as { __lastScroll?: ScrollIntoViewOptions }).__lastScroll = opts;
    };
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

describe("ImageLightbox 开合生命周期（动效批 Task 5）", () => {
  beforeEach(() => {
    cleanup();
    setUiMotionEnabled(true);
    HTMLElement.prototype.scrollIntoView = function scrollIntoViewStub(opts?: ScrollIntoViewOptions) {
      (document as unknown as { __lastScroll?: ScrollIntoViewOptions }).__lastScroll = opts;
    };
    // 缩略条定位走无参 canAnimateUi()（探测 documentElement.animate）——
    // jsdom 没有原生实现，给 html 元素装实例桩让全局探测为真
    document.documentElement.animate = function animateStub() {
      return {
        finished: Promise.resolve(),
        cancel() {},
        finish() {},
        commitStyles() {},
      } as unknown as Animation;
    };
  });

  it("open=false 在动效关闭时同步关闭（无透明拦截层残留）", async () => {
    setUiMotionEnabled(false);
    const { rerender } = render(
      <ImageLightbox items={ITEMS} index={0} open onClose={() => {}} onIndex={() => {}} />,
    );
    await act(async () => {});
    assert.ok(dialog(), "关停时静态打开");
    rerender(<ImageLightbox items={ITEMS} index={0} open={false} onClose={() => {}} onIndex={() => {}} />);
    await act(async () => {});
    assert.equal(dialog(), null, "同步卸载，没有透明拦截层");
    assert.equal(document.body.style.overflow, "", "滚动锁释放");
  });

  it("进场播放中关闭动效：open=true 保持可见（跳到终态而非消失）", async () => {
    // 首轮进场在 render 内同步完成（无法中途桩）——用「退出到一半重开」覆盖进场路径：
    // 重开的进场动画从当前视觉续播，桩可先装好
    const { rerender } = render(
      <ImageLightbox items={ITEMS} index={0} open onClose={() => {}} onIndex={() => {}} />,
    );
    await act(async () => {});
    const { plays } = stubDialogAnimate();
    rerender(<ImageLightbox items={ITEMS} index={0} open={false} onClose={() => {}} onIndex={() => {}} />);
    await act(async () => {});
    assert.equal(plays.length, 1, "退出播放中");
    rerender(<ImageLightbox items={ITEMS} index={0} open onClose={() => {}} onIndex={() => {}} />);
    await act(async () => {});
    assert.equal(plays.length, 2, "重开进场播放中（finished 永远 pending）");
    const stage = dialog() as HTMLElement;
    // 进场在播：关掉动效 → 运行时跳终点（open=true 保持可见，不消失）
    setUiMotionEnabled(false);
    await act(async () => {});
    assert.ok(dialog(), "open=true 仍可见");
    assert.equal(stage.isConnected, true);
  });

  it("close→open 快速反向：旧退出的回调关不掉新灯箱", async () => {
    const { rerender } = render(
      <ImageLightbox items={ITEMS} index={0} open onClose={() => {}} onIndex={() => {}} />,
    );
    await act(async () => {});
    const { plays } = stubDialogAnimate();

    rerender(<ImageLightbox items={ITEMS} index={0} open={false} onClose={() => {}} onIndex={() => {}} />);
    await act(async () => {});
    assert.equal(plays.length, 1, "退出播放中");
    assert.ok(dialog(), "退出动画期间仍在（非同步卸载）");

    rerender(<ImageLightbox items={ITEMS} index={0} open onClose={() => {}} onIndex={() => {}} />);
    await act(async () => {});
    assert.ok(dialog(), "中途重开：灯箱仍在（旧收尾未生效）");
    // 最终真正关闭：退出完成 → 卸载
    rerender(<ImageLightbox items={ITEMS} index={0} open={false} onClose={() => {}} onIndex={() => {}} />);
    await act(async () => {});
    assert.ok(dialog(), "退出播放中（新的一代）");
  });

  it("退出完成才卸载；退出播放中关动效立即落卸载", async () => {
    setUiMotionEnabled(true);
    const { rerender } = render(
      <ImageLightbox items={ITEMS} index={0} open onClose={() => {}} onIndex={() => {}} />,
    );
    await act(async () => {});
    stubDialogAnimate();
    rerender(<ImageLightbox items={ITEMS} index={0} open={false} onClose={() => {}} onIndex={() => {}} />);
    await act(async () => {});
    assert.ok(dialog(), "动画路径：退出未完成前不卸载");

    // 退出播放中途关掉动效：运行时跳终点，收尾立即执行——不留透明拦截层
    setUiMotionEnabled(false);
    await act(async () => {});
    assert.equal(dialog(), null, "退出即时落终态并卸载");
    assert.equal(document.body.style.overflow, "", "滚动锁释放");
  });

  it("首轮进场从隐藏态展开；退出起点截自当前视觉", async () => {
    setUiMotionEnabled(true);
    // 首轮进场发生在 render 提交内（dialog 尚未存在，元素级桩装不上）——
    // 在 HTMLElement 原型上拦 aria-label 录帧，其余元素走原实现。
    const plays: DialogAnim[] = [];
    const proto = HTMLElement.prototype;
    const orig = proto.animate;
    proto.animate = function (this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
      if (this.getAttribute("aria-label") === "大图预览") {
        plays.push({ frames, options });
        return { finished: new Promise(() => {}), cancel() {}, finish() {}, commitStyles() {} } as Animation;
      }
      return orig.call(this, frames, options);
    };
    try {
      const { rerender } = render(
        <ImageLightbox items={ITEMS} index={0} open onClose={() => {}} onIndex={() => {}} />,
      );
      await act(async () => {});
      assert.equal(plays.length, 1, "首轮进场播放了一次");
      assert.equal((plays[0]!.frames[0] as { opacity?: string }).opacity, "0", "起点是隐藏态（非 1→1 空操作）");
      assert.match(String((plays[0]!.frames[1] as { transform?: string }).transform), /scale\(1\)/, "终点复位");
      rerender(<ImageLightbox items={ITEMS} index={0} open={false} onClose={() => {}} onIndex={() => {}} />);
      await act(async () => {});
      assert.equal(plays.length, 2, "退出播放");
      const from = plays[1]!.frames[0] as { opacity?: string };
      assert.equal(from.opacity, "1", "退出起点=截自当前视觉（提交值），非硬编码");
    } finally {
      proto.animate = orig;
    }
  });

  it("拖拽/捏合期间内层无过渡（直接跟手），抬指后恢复短过渡", async () => {
    render(<ImageLightbox items={ITEMS} index={0} open onClose={() => {}} onIndex={() => {}} />);
    await act(async () => {});
    const stage = dialog()?.querySelector(".overflow-hidden") as HTMLElement;
    assert.ok(stage, "手势舞台在位");
    const layer = transformLayer()!;
    assert.match(layer.className, /kami-zoom-smooth/, "静止时离散缩放走短过渡");

    // 放大到 >1 才有可拖拽的 offset；先用按钮（离散）放大
    fireEvent.click(dialog()!.querySelector('[aria-label="放大"]') as HTMLElement);
    await act(async () => {});
    assert.match(layer.className, /kami-zoom-smooth/, "按钮缩放仍是短过渡（离散）");

    // 单指按下进入手势：摘掉过渡类，move 即时改 transform
    pointer(stage, "pointerdown", { pointerId: 1, clientX: 300, clientY: 300 });
    pointer(stage, "pointermove", { pointerId: 1, clientX: 380, clientY: 320 });
    await act(async () => {});
    assert.doesNotMatch(layer.className, /kami-zoom-smooth/, "手势期间零补间");
    const midTransform = layer.style.transform;
    assert.match(midTransform, /translate\(/, "拖拽直接写 transform");
    const afterMove = layer.style.transform;

    // 第二指落下成捏合：仍然零补间，scale 跟手指走
    pointer(stage, "pointerdown", { pointerId: 2, clientX: 500, clientY: 300, isPrimary: false });
    pointer(stage, "pointermove", { pointerId: 2, clientX: 560, clientY: 300 });
    await act(async () => {});
    assert.doesNotMatch(layer.className, /kami-zoom-smooth/, "捏合期间零补间");
    assert.notEqual(layer.style.transform, afterMove, "捏合改写变换");

    // 双指回落单指：拖拽继续跟手（基准换成剩余指）
    pointer(stage, "pointerup", { pointerId: 2, clientX: 560, clientY: 300 });
    pointer(stage, "pointermove", { pointerId: 1, clientX: 420, clientY: 340 });
    await act(async () => {});
    assert.doesNotMatch(layer.className, /kami-zoom-smooth/, "回落单指仍在手势中");

    // 全部抬起：恢复短过渡
    pointer(stage, "pointerup", { pointerId: 1, clientX: 420, clientY: 340 });
    await act(async () => {});
    assert.match(layer.className, /kami-zoom-smooth/, "抬指后恢复离散短过渡");
  });

  it("缩略条定位：只滚缩略条自身，不动页面滚动", async () => {
    setUiMotionEnabled(true);
    const { rerender } = render(
      <ImageLightbox items={ITEMS} index={1} open onClose={() => {}} onIndex={() => {}} />,
    );
    await act(async () => {});
    const strip = document.querySelector(".kami-lightbox-strip") as HTMLElement;
    assert.ok(strip, "缩略条在位");
    const calls: ScrollToOptions[] = [];
    strip.scrollTo = ((opts?: ScrollToOptions) => {
      if (opts) calls.push(opts);
    }) as typeof strip.scrollTo;
    // 换页（index 由父组件控制）触发定位
    rerender(<ImageLightbox items={ITEMS} index={0} open onClose={() => {}} onIndex={() => {}} />);
    await act(async () => {});
    assert.equal(
      (document as unknown as { __lastScroll?: ScrollIntoViewOptions }).__lastScroll,
      undefined,
      "不再用 scrollIntoView（会沿祖先链滚 window）",
    );
    assert.equal(calls.length, 1, "缩略条自身平滑定位一次");
    assert.equal(calls[0]?.behavior, "smooth", "动效开：平滑滚动");

    // 动效关闭：直接落位（scrollLeft 赋值），不走 scrollTo
    setUiMotionEnabled(false);
    rerender(<ImageLightbox items={ITEMS} index={1} open onClose={() => {}} onIndex={() => {}} />);
    await act(async () => {});
    assert.equal(calls.length, 1, "关停后不再平滑滚动");
  });

  it("unmount 恢复 body overflow", async () => {
    document.body.style.overflow = "";
    const { unmount } = render(
      <ImageLightbox items={ITEMS} index={0} open onClose={() => {}} onIndex={() => {}} />,
    );
    await act(async () => {});
    assert.equal(document.body.style.overflow, "hidden", "打开时锁滚动");
    unmount();
    assert.equal(document.body.style.overflow, "", "卸载后恢复");
    assert.equal(dialog(), null);
  });
});
