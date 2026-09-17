"use client";

/**
 * 纸匣批量标签动作区（BatchToolbar 的自定义动作槽）。
 *
 * 作用：选择模式下给选中藏品「加标签 / 删标签」。删除按展示名（过别名归一）匹配
 *      ——删「鳴潮」连同「鸣潮」这类变体原文一起移除；加标签把变体输入归一成规范
 *      名原文写入（不展开成变体）。确认钮直接带影响张数（「加标签 · 影响 3 张」），
 *      不另设确认弹层；零张可影响时禁用，不虚报。
 * 用法：<BatchToolbar ...><VaultBatchActions selectedItems tagOptions tagAliases onApply /></BatchToolbar>
 *      onApply(kind, tag, entries) 由页面执行 putVaultMeta 落库 + toast + refresh；
 *      entries 是真正要改写的条目（meta + 新 tags），影响张数即 entries.length。
 * 为什么：匹配语义在 vault-tag-alias.ts 纯函数（tagsAfterAdd / tagsAfterRemove，
 *        Node 测试锁语义），这里只管挑名字与预览张数；IO 与提示留在页面层。
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { vaultTags } from "@/lib/storage/vault-query";
import { applyTagAlias, tagsAfterAdd, tagsAfterRemove } from "@/lib/vault-tag-alias";
import type { VaultMeta } from "@/lib/types";
import { cn } from "@/lib/utils";

export type BatchTagEntry = { meta: VaultMeta; tags: string[] };

/** 逐张算改写结果：纯函数返回 null（删无命中 / 加已有效）的条目不进 entries。 */
function entriesFor(
  kind: "add" | "remove",
  target: string,
  items: readonly VaultMeta[],
  aliases: Record<string, string>,
): BatchTagEntry[] {
  if (!target) return [];
  const out: BatchTagEntry[] = [];
  for (const meta of items) {
    const tags = kind === "add" ? tagsAfterAdd(meta.tags, target, aliases) : tagsAfterRemove(meta.tags, target, aliases);
    if (tags) out.push({ meta, tags });
  }
  return out;
}

function AddTagPanel({
  items,
  tagOptions,
  tagAliases,
  onApply,
  onClose,
}: {
  items: readonly VaultMeta[];
  tagOptions: readonly string[];
  tagAliases: Record<string, string>;
  onApply: (kind: "add" | "remove", tag: string, entries: BatchTagEntry[]) => void | Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const trimmed = value.trim();
  const entries = useMemo(() => entriesFor("add", trimmed, items, tagAliases), [trimmed, items, tagAliases]);
  const resolved = applyTagAlias(trimmed, tagAliases);
  // 联想：全库展示名按包含匹配，排除归一后与输入相同的那个
  const hits = trimmed ? tagOptions.filter((t) => t !== resolved && t.includes(trimmed)).slice(0, 6) : [];
  return (
    <div className="space-y-3">
      <p className="text-xs text-subtle">给 {items.length} 张选中的藏品加标签</p>
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="输入标签名" autoFocus />
      {hits.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {hits.map((tag) => (
            <button
              key={tag}
              type="button"
              className="h-8 rounded-full bg-elevated px-3 text-sm text-muted hover:text-fg"
              onClick={() => setValue(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null}
      {trimmed && resolved !== trimmed ? <p className="text-xs text-subtle">将按规范名「{resolved}」写入</p> : null}
      <Button
        size="sm"
        className="w-full"
        disabled={!trimmed || entries.length === 0}
        onClick={() => {
          void onApply("add", resolved, entries);
          onClose();
        }}
      >
        加标签 · 影响 {entries.length} 张
      </Button>
    </div>
  );
}

function RemoveTagPanel({
  items,
  tagAliases,
  onApply,
  onClose,
}: {
  items: readonly VaultMeta[];
  tagAliases: Record<string, string>;
  onApply: (kind: "add" | "remove", tag: string, entries: BatchTagEntry[]) => void | Promise<void>;
  onClose: () => void;
}) {
  // 候选 = 选中作品标签的展示名并集（过别名、去重、按出现次数排序）
  const union = useMemo(() => vaultTags(items, tagAliases), [items, tagAliases]);
  const [target, setTarget] = useState("");
  const entries = useMemo(() => entriesFor("remove", target, items, tagAliases), [target, items, tagAliases]);
  return (
    <div className="space-y-3">
      <p className="text-xs text-subtle">从 {items.length} 张选中的藏品里删标签</p>
      {union.length === 0 ? (
        <p className="text-sm text-muted">选中的藏品还没有标签。</p>
      ) : (
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {union.map((tag) => (
            <button
              key={tag}
              type="button"
              className={cn(
                "h-8 rounded-full px-3 text-sm",
                target === tag ? "bg-accent text-accent-fg" : "bg-elevated text-muted hover:text-fg",
              )}
              onClick={() => setTarget((v) => (v === tag ? "" : tag))}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
      {/* 文案如实说明匹配口径（PRD）：按展示名删，变体原文一起走 */}
      <p className="text-xs text-subtle">按展示名匹配：删「鳴潮」会连同「鸣潮」这类变体原文一起移除。</p>
      <Button
        size="sm"
        className="w-full"
        disabled={!target || entries.length === 0}
        onClick={() => {
          void onApply("remove", target, entries);
          onClose();
        }}
      >
        删标签 · 影响 {entries.length} 张
      </Button>
    </div>
  );
}

export function VaultBatchActions({
  selectedItems,
  tagOptions,
  tagAliases,
  onApply,
}: {
  /** 当前选中的藏品（按 key 从全量目录取，改筛选也不丢已选）。 */
  selectedItems: readonly VaultMeta[];
  /** 全库展示名（vaultTags），加标签的联想源。 */
  tagOptions: readonly string[];
  tagAliases: Record<string, string>;
  onApply: (kind: "add" | "remove", tag: string, entries: BatchTagEntry[]) => void | Promise<void>;
}) {
  const [open, setOpen] = useState<"add" | "remove" | null>(null);
  const disabled = selectedItems.length === 0;
  const panelProps = { items: selectedItems, tagAliases, onApply, onClose: () => setOpen(null) };
  return (
    <>
      <Popover open={open === "add"} onOpenChange={(o) => setOpen(o ? "add" : null)}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="secondary" disabled={disabled}>
            加标签
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-72">
          <AddTagPanel {...panelProps} tagOptions={tagOptions} />
        </PopoverContent>
      </Popover>
      <Popover open={open === "remove"} onOpenChange={(o) => setOpen(o ? "remove" : null)}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="secondary" disabled={disabled}>
            删标签
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-72">
          <RemoveTagPanel {...panelProps} />
        </PopoverContent>
      </Popover>
    </>
  );
}
