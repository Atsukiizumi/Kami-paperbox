/**
 * 入队时一张纸飞向侧栏「队列」。
 *
 * 作用：点下载 / 收入纸匣后，封面缩成纸片飞到队列角标。
 * 用法：flyPaperToQueue(card.getBoundingClientRect())。
 * 为什么：toast 会忘；看见纸飞进队列，才知道任务去了哪。
 */
export function flyPaperToQueue(from?: DOMRect | null) {
  if (typeof document === "undefined") return;
  const dest =
    document.querySelector<HTMLElement>("[data-queue-nav].kami-queue-nav-desktop") ||
    document.querySelector<HTMLElement>("[data-queue-nav]");
  if (!dest || !from || from.width < 8) return;
  const to = dest.getBoundingClientRect();
  const sheet = document.createElement("div");
  sheet.className = "kami-fly-sheet";
  const left = from.left + from.width / 2 - 14;
  const top = from.top + 8;
  sheet.style.left = `${left}px`;
  sheet.style.top = `${top}px`;
  document.body.appendChild(sheet);
  const dx = to.left + to.width / 2 - 14 - left;
  const dy = to.top + to.height / 2 - 10 - top;
  const motion = sheet.animate(
    [
      { transform: "translate(0,0) rotate(-6deg) scale(1)", opacity: 1 },
      { transform: `translate(${dx * 0.6}px, ${dy * 0.4}px) rotate(8deg) scale(0.7)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) rotate(12deg) scale(0.2)`, opacity: 0.2 },
    ],
    { duration: 620, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" },
  );
  void motion.finished.finally(() => sheet.remove());
}

export function rectFromEvent(target: EventTarget | null): DOMRect | null {
  if (!(target instanceof Element)) return null;
  return target.getBoundingClientRect();
}
