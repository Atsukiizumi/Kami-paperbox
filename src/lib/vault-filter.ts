/**
 * 纸匣筛选笺与纸内列表的纯函数。
 *
 * 作用：从筛选 state 算出页上已选笺、点笺后的 state、纸内可见标签/作者。
 * 用法：VaultFilter 关闭态用 vaultFilterSlips；标签段用 visibleVaultTags。
 * 为什么：笺顺序和 40 条上限写进单测，避免 UI 里再摊站点 Chip。
 */
import type { AuthorOption } from "./storage/vault-query.ts";
import { siteLabel } from "./sites.ts";
import type { Source } from "./types.ts";

export const VAULT_TAG_VISIBLE = 40;

export type VaultFilterState = {
  source: Source | "all";
  authorKey: string;
  tags: string[];
  month: string;
  unreadOnly: boolean;
  recallOnly: boolean;
};

export const EMPTY_VAULT_FILTER: VaultFilterState = {
  source: "all",
  authorKey: "",
  tags: [],
  month: "",
  unreadOnly: false,
  recallOnly: false,
};

export type VaultFilterSlip = {
  kind: "source" | "author" | "tag" | "month" | "unread" | "recall";
  key: string;
  label: string;
};

export function vaultFilterSlips(
  state: VaultFilterState,
  ctx: { authorName: string },
): VaultFilterSlip[] {
  const slips: VaultFilterSlip[] = [];
  if (state.source !== "all") {
    slips.push({ kind: "source", key: state.source, label: siteLabel(state.source) });
  }
  if (state.authorKey) {
    slips.push({ kind: "author", key: state.authorKey, label: ctx.authorName });
  }
  for (const tag of state.tags) {
    slips.push({ kind: "tag", key: tag, label: tag });
  }
  if (state.month) {
    slips.push({ kind: "month", key: state.month, label: state.month });
  }
  if (state.unreadOnly) {
    slips.push({ kind: "unread", key: "unread", label: "未读" });
  }
  if (state.recallOnly) {
    slips.push({ kind: "recall", key: "recall", label: "今日去年" });
  }
  return slips;
}

export function applySlipClear(state: VaultFilterState, slip: VaultFilterSlip): VaultFilterState {
  switch (slip.kind) {
    case "source":
      return { ...state, source: "all" };
    case "author":
      return { ...state, authorKey: "" };
    case "tag":
      return { ...state, tags: state.tags.filter((t) => t !== slip.key) };
    case "month":
      return { ...state, month: "" };
    case "unread":
      return { ...state, unreadOnly: false };
    case "recall":
      return { ...state, recallOnly: false };
  }
}

export function clearVaultFilter(_state: VaultFilterState): VaultFilterState {
  return { ...EMPTY_VAULT_FILTER };
}

export function visibleVaultTags(
  orderedByFreq: string[],
  selected: string[],
  query: string,
  limit: number = VAULT_TAG_VISIBLE,
): string[] {
  const q = query.trim();
  if (q) {
    const lower = q.toLowerCase();
    return orderedByFreq.filter((t) => t.toLowerCase().includes(lower));
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of selected) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  const selectedUniqLen = out.length;
  for (const t of orderedByFreq) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, Math.max(limit, selectedUniqLen));
}

export function filterAuthorOptions(options: AuthorOption[], query: string): AuthorOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) => o.name.toLowerCase().includes(q));
}
