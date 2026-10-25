/**
 * 飞纸入队行为测试（动效批 2026-10-25 · Task 4）。
 *
 * 作用：锁「可见目标选择、三张在途上限、关停即清场」。
 * 用法：node --import tsx --test src/lib/paper-fly.test.ts。
 * 为什么：飞纸是纯装饰反馈——目标选到隐藏节点会飞向零尺寸坐标，无限叠纸
 *   片会糊屏；jsdom 无 WAAPI，用原型级 double 驱动真实注册/收尾路径。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { flyPaperToQueue, visibleQueueTarget } from "./paper-fly.ts";
import { setUiMotionEnabled } from "./motion-runtime.ts";

(window as { innerWidth: number }).innerWidth = 1280;
(window as { innerHeight: number }).innerHeight = 800;

function rectOf(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function queueLink(opts: { desktop?: boolean; hidden?: boolean; offscreen?: boolean }) {
  const el = document.createElement("a");
  el.setAttribute("data-queue-nav", "");
  if (opts.desktop) el.className = "kami-queue-nav-desktop";
  el.getBoundingClientRect = () =>
    opts.offscreen ? rectOf(20, 5000, 120, 40) : rectOf(20, 60, 120, 40);
  if (opts.hidden) el.hidden = true;
  return el;
}

/** 原型级 WAAPI double：飞纸的节点在函数内部创建，只能从原型截。 */
function installSheetDouble() {
  const proto = (window as unknown as { HTMLElement: { prototype: HTMLElement } }).HTMLElement.prototype;
  const original = proto.animate;
  let created = 0;
  proto.animate = function (this: HTMLElement) {
    created += 1;
    (this as unknown as { __created?: number }).__created = created;
    let reject!: (reason?: unknown) => void;
    const finished = new Promise((_resolve, rej) => {
      reject = rej;
    });
    void finished.catch(() => undefined);
    return {
      finished,
      cancel: () => reject(new Error("cancelled")),
    } as Animation;
  } as typeof proto.animate;
  return {
    restore: () => {
      proto.animate = original;
    },
    count: () => created,
  };
}

const FROM = rectOf(500, 300, 120, 160);

test.afterEach(() => {
  document.body.innerHTML = "";
  setUiMotionEnabled(true);
});

test("hidden desktop nav yields to the visible mobile queue link", () => {
  const aside = document.createElement("aside");
  aside.hidden = true;
  const desktop = queueLink({ desktop: true });
  aside.appendChild(desktop);
  const mobile = queueLink({});
  document.body.append(aside, mobile);
  assert.equal(visibleQueueTarget(), mobile);
});

test("visible desktop nav wins over mobile when both shown", () => {
  const desktop = queueLink({ desktop: true });
  const mobile = queueLink({});
  document.body.append(desktop, mobile);
  assert.equal(visibleQueueTarget(), desktop);
});

test("no target at all returns null（隐藏、离屏、零尺寸都算无目标）", () => {
  assert.equal(visibleQueueTarget(), null);
  document.body.append(queueLink({ hidden: true }), queueLink({ offscreen: true }));
  const zero = queueLink({});
  zero.getBoundingClientRect = () => rectOf(0, 0, 0, 0);
  document.body.appendChild(zero);
  assert.equal(visibleQueueTarget(), null);
});

test("20 次连续入队最多三张在途纸片，关停后全部清场", async () => {
  setUiMotionEnabled(true);
  const double = installSheetDouble();
  try {
    document.body.appendChild(queueLink({ desktop: true }));
    for (let i = 0; i < 20; i += 1) flyPaperToQueue(FROM);
    const sheets = document.querySelectorAll(".kami-fly-sheet");
    assert.ok(sheets.length <= 3, `在途纸片 ${sheets.length} 张（上限 3）`);
    assert.equal(double.count(), 3, "只有三张真正起播");

    setUiMotionEnabled(false);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(document.querySelectorAll(".kami-fly-sheet").length, 0, "关停即清场");
  } finally {
    double.restore();
  }
});

test("无可见目标时直接结束，不产生任何节点", () => {
  setUiMotionEnabled(true);
  const double = installSheetDouble();
  try {
    flyPaperToQueue(FROM);
    assert.equal(document.querySelectorAll(".kami-fly-sheet").length, 0);
    assert.equal(double.count(), 0);
  } finally {
    double.restore();
  }
});

test("无 WAAPI（老环境）时纸片即刻移除", () => {
  setUiMotionEnabled(true);
  const proto = (window as unknown as { HTMLElement: { prototype: HTMLElement } }).HTMLElement.prototype;
  const original = proto.animate;
  proto.animate = undefined as unknown as typeof proto.animate;
  try {
    document.body.appendChild(queueLink({ desktop: true }));
    flyPaperToQueue(FROM);
    assert.equal(document.querySelectorAll(".kami-fly-sheet").length, 0);
  } finally {
    proto.animate = original;
  }
});
