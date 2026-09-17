/**
 * 批量选择状态 hook（画师页 / 用户页 / 纸匣页共用的多选底座）。
 *
 * 作用：持有「选择模式开关 + 选中 key 集合」，给出入口开合、单卡勾选、全选、
 *      清空、退出五个动作；开合与退出都清空集合，语义与拆分前两页的手写实现
 *      完全一致（行为零变化的搬运）。
 * 用法：const sel = useBatchSelection();
 *      入口按钮 onClick={sel.toggleActive}；网格 selection={{ selected: sel.selected, onToggle: sel.toggle }}；
 *      BatchToolbar onSelectAll={() => sel.selectAll(items.map(keyOf))} onClear={sel.clear} onDone={sel.exit}。
 * 为什么：creator / user 两页各复制过一份 ~60 行的选择逻辑（挂账 TD），纸匣批量
 *        整理（标签）要第三份——抽成 hook 消重复，纸感交互仍由各页自己接。
 */
import { useState } from "react";

export type BatchSelection = {
  /** 选择模式是否开着（开着才渲染勾选圈与工具条）。 */
  active: boolean;
  /** 选中集合（浏览页是 `${source}:${id}`，纸匣页是 VaultMeta.key）。 */
  selected: Set<string>;
  /** 单卡勾选 / 取消。 */
  toggle: (key: string) => void;
  /** 用给定 key 全量替换选中集合（当前列表全选用）。 */
  selectAll: (keys: Iterable<string>) => void;
  /** 清空选中，选择模式保持开着。 */
  clear: () => void;
  /** 入口按钮：开 / 关选择模式，开合都清空集合。 */
  toggleActive: () => void;
  /** 退出选择模式并清空集合（工具条完成钮、动作完成后用）。 */
  exit: () => void;
};

export function useBatchSelection(): BatchSelection {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function selectAll(keys: Iterable<string>) {
    setSelected(new Set(keys));
  }
  function clear() {
    setSelected(new Set());
  }
  function toggleActive() {
    setActive((v) => !v);
    setSelected(new Set());
  }
  function exit() {
    setActive(false);
    setSelected(new Set());
  }

  return { active, selected, toggle, selectAll, clear, toggleActive, exit };
}
