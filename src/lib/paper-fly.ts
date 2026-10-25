/**
 * 入队时一张纸飞向侧栏「队列」。
 *
 * 作用：点下载 / 收入纸匣后，封面缩成纸片飞到队列入口。
 * 用法：flyPaperToQueue(card.getBoundingClientRect())；目标选择用
 *      visibleQueueTarget()（尺寸有效、未隐藏、在视口内的 [data-queue-nav]）。
 * 为什么：toast 会忘；看见纸飞进队列，才知道任务去了哪。飞纸只表示「已入队」，
 *        不提前显示完成——业务 enqueue 先发生，动画只是反馈，失败不影响入队。
 *        在途纸片最多三张（动效批 Task 4）：连续点按时超出的直接跳过视觉，
 *        队列计数与 toast 照常准确。动画交给 motion-runtime 托管——关停/取消/
 *        结束都会把临时节点摘掉。
 */
import { canAnimateUi, playOwnedMotion, readMotionTiming } from "./motion-runtime.ts";

/** 同时在途的纸片上限：再多只会糊成一片，合并掉反而看得清。 */
const MAX_IN_FLIGHT = 3;

export function visibleQueueTarget(root: ParentNode = document): HTMLElement | null {
  if (typeof document === "undefined" || root === null) return null;
  const view = root instanceof Document ? root.defaultView : (root as Element).ownerDocument?.defaultView;
  const vw = view?.innerWidth ?? 0;
  const vh = view?.innerHeight ?? 0;
  if (vw <= 0 || vh <= 0) return null;
  let desktop: HTMLElement | null = null;
  let any: HTMLElement | null = null;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-queue-nav]"))) {
    if (el.closest("[hidden]")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
    if (!desktop && el.classList.contains("kami-queue-nav-desktop")) desktop = el;
    else if (!any) any = el;
  }
  return desktop ?? any;
}

export function flyPaperToQueue(from?: DOMRect | null) {
  if (typeof document === "undefined") return;
  const dest = visibleQueueTarget();
  if (!dest || !from || from.width < 8) return;
  // 超过三张在途：跳过额外的纸片（视觉合并），业务入队与计数不受影响
  if (document.querySelectorAll(".kami-fly-sheet").length >= MAX_IN_FLIGHT) return;

  const to = dest.getBoundingClientRect();
  const sheet = document.createElement("div");
  sheet.className = "kami-fly-sheet";
  const left = from.left + from.width / 2 - 14;
  const top = from.top + 8;
  sheet.style.left = `${left}px`;
  sheet.style.top = `${top}px`;
  document.body.appendChild(sheet);

  if (!canAnimateUi(sheet)) {
    sheet.remove();
    return;
  }
  const dx = to.left + to.width / 2 - 14 - left;
  const dy = to.top + to.height / 2 - 10 - top;
  const { duration, easing } = readMotionTiming(sheet, "slow");
  const motion = playOwnedMotion(
    sheet,
    [
      { transform: "translate(0,0) rotate(-6deg) scale(1)", opacity: 1 },
      { transform: `translate(${dx * 0.6}px, ${dy * 0.4}px) rotate(8deg) scale(0.7)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) rotate(12deg) scale(0.2)`, opacity: 0.2 },
    ],
    { duration, easing, fill: "forwards" },
  );
  // finished 对任何终态都 resolve（结束/取消/关停跳终点）——统一摘节点
  void motion.finished.then(() => sheet.remove());
}

export function rectFromEvent(target: EventTarget | null): DOMRect | null {
  if (!(target instanceof Element)) return null;
  return target.getBoundingClientRect();
}
