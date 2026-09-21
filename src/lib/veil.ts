/**
 * 访客遮盖模式（U，09-22-product-batch-2）。
 *
 * 作用：一键模糊 R-18 / AI 封面——临时演示或给人看屏幕的场景。
 * 用法：顶栏 EyeOff 开关切 useVeil；封面容器按 shouldVeil(work) 加 blur 类。
 * 为什么非持久：演示是瞬时场景，刷新即关、不进设置段（忘了关比忘了开更糟）。
 */
import { create } from "zustand";
import { isBooru } from "./sites.ts";
import { isNsfwRating } from "./booru.ts";
import { isAiWork } from "./pixiv-feed.ts";
import type { WorkCard } from "./types.ts";

type VeilState = {
  veil: boolean;
  toggle: () => void;
  off: () => void;
};

export const useVeil = create<VeilState>()((set) => ({
  veil: false,
  toggle: () => set((s) => ({ veil: !s.veil })),
  off: () => set({ veil: false }),
}));

/** 遮盖判定：R-18（xRestrict / booru nsfw rating）或 AI 作画（含词表兜底）。 */
export function shouldVeil(work: Pick<WorkCard, "source" | "xRestrict" | "rating" | "aiType" | "tags">): boolean {
  if ((work.xRestrict ?? 0) > 0) return true;
  if (isBooru(work.source) && work.rating && isNsfwRating(work.rating, work.source)) return true;
  return isAiWork(work);
}
