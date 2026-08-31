/**
 * 纸匣目录索引（只记 key，不记原图）。
 *
 * 作用：浏览卡片和作品页显示「已在纸匣」，保存后立刻亮起来。
 * 用法：useVaultIndex(s => s.keys[`${source}:${id}`])；启动时 refresh()。
 * 为什么：listVault 要读完所有 meta 才知道有没有，不能每次点卡片都扫一遍。
 */
import { create } from "zustand";
import type { VaultMeta } from "./types";
import { listVault, workKey } from "./vault";
import { listServerVault } from "./vault-sync";

type VaultIndex = {
  keys: Record<string, true>;
  ready: boolean;
  add: (key: string) => void;
  remove: (key: string) => void;
  refresh: () => Promise<void>;
};

function mapKeys(rows: VaultMeta[]): Record<string, true> {
  const keys: Record<string, true> = {};
  for (const row of rows) keys[row.key] = true;
  return keys;
}

export const useVaultIndex = create<VaultIndex>((set) => ({
  keys: {},
  ready: false,
  add: (key) => set((s) => (s.keys[key] ? s : { keys: { ...s.keys, [key]: true } })),
  remove: (key) =>
    set((s) => {
      if (!s.keys[key]) return s;
      const keys = { ...s.keys };
      delete keys[key];
      return { keys };
    }),
  refresh: async () => {
    const remote = await listServerVault();
    const rows = remote?.items ?? (await listVault());
    set({ keys: mapKeys(rows), ready: true });
  },
}));

export function rememberVaultKey(source: string, id: string) {
  useVaultIndex.getState().add(workKey(source, id));
}

export function forgetVaultKey(key: string) {
  useVaultIndex.getState().remove(key);
}

export function isInVault(source: string, id: string): boolean {
  return Boolean(useVaultIndex.getState().keys[workKey(source, id)]);
}
