/**
 * UI 动效运行时（动效批 2026-10-25 · Task 1 基座）。
 *
 * 作用：给所有 JS（WAAPI）驱动的 UI 动画一个统一生命周期——起播前读应用内
 *   动效开关、结束后固化终态并回收 will-change、开关中途关闭时把在播动画
 *   一并收尾。时长与曲线从计算样式读 CSS token，SSR / 无 WAAPI 时直接终态。
 * 用法：ThemeProvider 水合与开关变化时 setUiMotionEnabled(...)；动画调用方
 *   先把底层 DOM/CSS 摆成最终状态，再 playOwnedMotion(el, frames, opts, onFinish)
 *   用关键帧覆盖短暂过程；改向前 commitOwnedMotion(el) 截住当前视觉。
 * 为什么：原生 finished 在 cancel 时 reject、fill:"both" 会把关键帧效果
 *   永远留在元素上、关开关没人通知在播动画——这三件事散在各处必然漂移；
 *   收进一个模块才守得住「关掉动画，画面立即落到正确终点」。只登记本模块
 *   创建的动画，绝不动媒体 GIF/Ugoira 或第三方组件的动画。
 */

export type MotionPreset = "micro" | "quick" | "layer" | "fast" | "slow";
export type MotionEnd = "finished" | "cancelled" | "disabled";

export type OwnedMotion = {
  /** 总是 resolve（绝不 reject）；cancelled 表示改向/卸载，不执行 onFinish。 */
  finished: Promise<MotionEnd>;
  /** 立即完成当前状态转换（跳到终点帧），执行一次 onFinish。 */
  finish(): void;
  /** 放弃补间，元素落回底层最终状态；不执行 onFinish。 */
  cancel(): void;
};

type NativeAnimation = {
  finished: Promise<unknown>;
  cancel(): void;
  finish?(): void;
  commitStyles?(): void;
};

type OwnedRecord = {
  el: HTMLElement;
  native: NativeAnimation | null;
  settled: boolean;
  runFinish: () => void;
  resolveFinished: (end: MotionEnd) => void;
};

/** unknown = 水合前策略未明（不起播）；on/off 由 ThemeProvider 同步。 */
type UiMotionPolicy = "unknown" | "on" | "off";
let policy: UiMotionPolicy = "unknown";

const owned = new Map<HTMLElement, Set<OwnedRecord>>();

const PRESET_VAR: Record<MotionPreset, string> = {
  micro: "--motion-micro",
  quick: "--motion-quick",
  layer: "--motion-layer",
  fast: "--motion-fast",
  slow: "--motion-slow",
};

/** 计算样式读不到时的兜底——与 styles.css 的 token 值一一对应。 */
const TIMING_FALLBACK: Record<MotionPreset, { duration: number; easing: string }> = {
  micro: { duration: 80, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  quick: { duration: 150, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  layer: { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  fast: { duration: 250, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  slow: { duration: 400, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
};

function parseDuration(raw: string): number | null {
  const value = raw.trim();
  const ms = /^(-?\d+(?:\.\d+)?)ms$/.exec(value);
  if (ms) return Math.round(Number(ms[1]));
  const sec = /^(-?\d+(?:\.\d+)?)s$/.exec(value);
  if (sec) return Math.round(Number(sec[1]) * 1000);
  return null;
}

export function readMotionTiming(el: Element, preset: MotionPreset): { duration: number; easing: string } {
  let rawDuration = "";
  let rawEasing = "";
  try {
    const cs = getComputedStyle(el);
    rawDuration = cs.getPropertyValue(PRESET_VAR[preset]);
    rawEasing = cs.getPropertyValue("--ease-out");
  } catch {
    // SSR 或无样式环境：走兜底表
  }
  const duration = parseDuration(rawDuration) ?? TIMING_FALLBACK[preset].duration;
  const easing = rawEasing.trim() || TIMING_FALLBACK[preset].easing;
  return { duration, easing };
}

/** 传 el 时按该元素探测 WAAPI（调用方常在元素上桩 animate）；不传时探测环境。 */
export function canAnimateUi(el?: Element): boolean {
  if (policy !== "on") return false;
  if (el) return typeof (el as { animate?: unknown }).animate === "function";
  return typeof document !== "undefined" && typeof document.documentElement?.animate === "function";
}

export function setUiMotionEnabled(enabled: boolean): void {
  const next: UiMotionPolicy = enabled ? "on" : "off";
  if (policy === next) return;
  policy = next;
  if (next === "off") {
    // 进行中的动画立即完成当前状态转换（跳终点帧再收效果），旧回调各执行一次。
    for (const rec of [...owned.values()].flatMap((set) => [...set])) {
      settle(rec, "finished", "jump");
    }
  }
}

export function hasOwnedAnimations(el: HTMLElement): boolean {
  return (owned.get(el)?.size ?? 0) > 0;
}

function readVisual(el: HTMLElement): { transform: string; opacity: number } {
  const cs = getComputedStyle(el);
  const raw = cs.transform;
  const transform = !raw || raw === "none" ? "matrix(1, 0, 0, 1, 0, 0)" : raw;
  const opacity = Number.parseFloat(cs.opacity);
  return { transform, opacity: Number.isFinite(opacity) ? opacity : 1 };
}

/** 把动画效果写进 style 再撤销原生动画，画面停在不跳的位置（transform/opacity 兜底手写）。 */
function commitVisual(el: HTMLElement, native: NativeAnimation): void {
  try {
    native.commitStyles?.();
    return;
  } catch {
    // commitStyles 不可用（伪元素 / 环境不支持）：transform/opacity 手动快照，
    // 其它属性（如 clipPath 在伪元素上）随效果撤销直接落回底层。
  }
  const visual = readVisual(el);
  el.style.transform = visual.transform;
  el.style.opacity = String(visual.opacity);
}

function unregister(rec: OwnedRecord): void {
  const set = owned.get(rec.el);
  if (!set) return;
  set.delete(rec);
  if (set.size === 0) owned.delete(rec.el);
}

function settle(rec: OwnedRecord, end: MotionEnd, mode: "drop" | "commit" | "jump"): void {
  if (rec.settled) return;
  rec.settled = true;
  unregister(rec);
  const { el, native } = rec;
  if (native) {
    if (mode === "jump") {
      // 跳到终点帧再收效果——「完成当前状态转换」。无限/零速率动画 finish() 会抛错，
      // 此时按约定落回底层静态状态（调用方播放前已把底层摆成最终态）。
      let jumped = false;
      try {
        native.finish?.();
        jumped = true;
      } catch {
        jumped = false;
      }
      if (jumped) commitVisual(el, native);
    } else if (mode === "commit") {
      commitVisual(el, native);
    }
    try {
      native.cancel();
    } catch {
      // 已 idle 的动画再 cancel 是幂等的；个别实现抛错也不影响收尾
    }
  }
  el.style.willChange = "";
  if (end === "finished") rec.runFinish();
  rec.resolveFinished(end);
}

export function playOwnedMotion(
  el: HTMLElement,
  frames: Keyframe[],
  options: KeyframeAnimationOptions,
  onFinish?: () => void,
): OwnedMotion {
  let resolveFinished: (end: MotionEnd) => void = () => {};
  const finished = new Promise<MotionEnd>((resolve) => {
    resolveFinished = resolve;
  });
  let finishOnce = false;
  const runFinish = () => {
    if (finishOnce) return;
    finishOnce = true;
    onFinish?.();
  };
  const rec: OwnedRecord = {
    el,
    native: null,
    settled: false,
    runFinish,
    resolveFinished: (end) => resolveFinished(end),
  };
  const settleRec = (end: MotionEnd, mode: "drop" | "commit" | "jump") => settle(rec, end, mode);
  const handle: OwnedMotion = {
    finished,
    finish: () => settleRec("finished", "jump"),
    cancel: () => settleRec("cancelled", "drop"),
  };

  // 策略未明 / 关闭 / 该元素没有 WAAPI（SSR、老环境）：不起播，onFinish 同步
  // 执行一次，终态由调用方摆好的底层承担。逐元素探测——环境级探测见 canAnimateUi。
  if (policy !== "on" || typeof (el as { animate?: unknown }).animate !== "function") {
    rec.settled = true;
    runFinish();
    resolveFinished("disabled");
    return handle;
  }

  try {
    rec.native = el.animate(frames, options) as unknown as NativeAnimation;
  } catch {
    rec.settled = true;
    runFinish();
    resolveFinished("disabled");
    return handle;
  }
  void rec.native.finished
    .then(() => settleRec("finished", "commit"))
    .catch(() => settleRec("cancelled", "drop"));
  const set = owned.get(el);
  if (set) set.add(rec);
  else owned.set(el, new Set([rec]));
  return handle;
}

/** 截住元素当前视觉（写行内快照）并取消本模块登记的该元素动画；不动别人的动画。 */
export function commitOwnedMotion(el: HTMLElement): { transform: string; opacity: number } {
  const visual = readVisual(el);
  el.style.transform = visual.transform;
  el.style.opacity = String(visual.opacity);
  cancelOwnedAnimations(el);
  return visual;
}

export function cancelOwnedAnimations(el: HTMLElement): void {
  for (const rec of [...(owned.get(el) ?? [])]) {
    settle(rec, "cancelled", "drop");
  }
  el.style.willChange = "";
}
