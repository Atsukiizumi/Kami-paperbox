/**
 * 追踪红点角标的本地状态（A）。
 *
 * 作用：记录上次检查的未读新作总数，供侧栏/顶栏角标显示。
 * 为什么只进 localStorage：角标是本机浏览态；真相在追踪列表水位（设置段同步）。
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

type WatchBadgeState = { newCount: number; set: (newCount: number) => void };

export const useWatchBadge = create<WatchBadgeState>()(
  persist(
    (set) => ({
      newCount: 0,
      set: (newCount) => set({ newCount: Math.max(0, Math.floor(newCount)) }),
    }),
    { name: "kami-watch-badge" },
  ),
);

/** 命令式设置角标（供检查流程调用）。 */
export function setWatchBadge(newCount: number): void {
  useWatchBadge.getState().set(newCount);
}
