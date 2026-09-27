/**
 * J/K 跨页步进纯函数（P2-d，#166 遗留）。
 *
 * 作用：把浏览页 J/K（含 ArrowDown/ArrowUp）的「页内移动 / 翻页 / clamp」
 *      判定抽成可单测的纯函数，browse.tsx 只剩接线。
 * 用法：onKey 里 const step = stepKbFocus(dir, kbFocus, items, { hasPrev, hasNext })；
 *      focus → setKbFocus；page → goListPage(listPage + delta) + 记 pendingKbLand。
 * 为什么：J 到页尾、K 到页首原来 clamp 在本页不翻页（#166 遗留）；有邻页时
 *      改为翻页落地（J→下页落页首，K→上页落页尾），无邻页保持 clamp 现状。
 *      规则写死在实现里，kb-paging.test.ts 逐条锁。
 */

export type KbFocusStep =
  | { kind: "focus"; index: number }
  | { kind: "page"; delta: 1 | -1; landAt: "head" | "tail" }
  | { kind: "noop" };

/**
 * J/K 单步判定：页内移动；焦点在页尾/页首且有邻页时翻页（J→下页落页首，
 * K→上页落页尾）；无邻页 clamp（现状行为不变）。items 为空 noop。
 */
export function stepKbFocus(
  dir: "next" | "prev",
  focus: number | null,
  items: { length: number },
  pager: { hasPrev: boolean; hasNext: boolean },
): KbFocusStep {
  const len = items.length;
  if (len === 0) return { kind: "noop" };
  if (dir === "next") {
    if (focus === null) return { kind: "focus", index: 0 };
    if (focus < len - 1) return { kind: "focus", index: focus + 1 };
    if (pager.hasNext) return { kind: "page", delta: 1, landAt: "head" };
    return { kind: "focus", index: len - 1 }; // 页尾 clamp：不翻，停在末卡
  }
  if (focus === null) return { kind: "noop" }; // 无焦点不动（现状 browse :387）
  if (focus > 0) return { kind: "focus", index: focus - 1 };
  if (pager.hasPrev) return { kind: "page", delta: -1, landAt: "tail" };
  return { kind: "focus", index: 0 }; // 页首 clamp：不翻，停在首卡
}
