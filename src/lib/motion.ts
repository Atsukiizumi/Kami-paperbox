/**
 * 进场动效。
 *
 * 作用：页面换路由时用 transform 做一次上移淡入。
 * 用法：playEnter(el)；不要对整页用 filter:blur，图层一多浏览器会直接跳过。
 * 为什么：预览环境常带 prefers-reduced-motion，CSS keyframe 会被打成 0ms。
 *        内联 transition 不依赖动画名，点榜单、切页都能看见。
 */
export const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

export function playEnter(el: HTMLElement, delay = 0) {
  el.style.opacity = "0";
  el.style.transform = "translate3d(0, 28px, 0)";
  const start = () => {
    el.style.transition = `opacity 480ms ${EASE_OUT} ${delay}ms, transform 480ms ${EASE_OUT} ${delay}ms`;
    el.style.opacity = "1";
    el.style.transform = "translate3d(0, 0, 0)";
  };
  requestAnimationFrame(() => requestAnimationFrame(start));
}
