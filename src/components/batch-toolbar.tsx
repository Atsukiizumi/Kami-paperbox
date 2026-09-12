"use client";

/**
 * 批量收藏浮动操作条（D）。
 *
 * 作用：选择模式下显示已选数、全选本页、清除、入纸匣、下载；超 BATCH_MAX 禁用。
 * 用法：<BatchToolbar selectedCount total visibleCards onSelectAll onClear onEnqueue onDone />
 *      入队动作由父级执行（filterBatchable + enqueueWorks），本组件只报意图。
 */
import { Download, FolderPlus, Square, CheckSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BATCH_MAX } from "@/lib/batch-collect";

export function BatchToolbar({
  selectedCount,
  total,
  onSelectAll,
  onClear,
  onEnqueue,
  onDone,
}: {
  selectedCount: number;
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  onEnqueue: (kind: "vault" | "download") => void;
  onDone: () => void;
}) {
  const over = selectedCount > BATCH_MAX;
  return (
    <div
      className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex flex-wrap items-center gap-2 rounded-xl border border-border/80 bg-bg/90 p-3 shadow-lg backdrop-blur-md md:bottom-6 md:left-auto md:right-6 md:max-w-md"
      role="toolbar"
      aria-label="批量收藏"
    >
      <span className="text-sm tabular-nums">
        已选 <b className={over ? "text-danger" : undefined}>{selectedCount}</b>
        {over ? ` / 上限 ${BATCH_MAX}` : ""}
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={selectedCount >= total ? onClear : onSelectAll}
        disabled={total === 0}
      >
        {selectedCount >= total && total > 0 ? <Square className="size-4" /> : <CheckSquare className="size-4" />}
        {selectedCount >= total && total > 0 ? "清除" : "全选本页"}
      </Button>
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" disabled={selectedCount === 0 || over} onClick={() => onEnqueue("vault")}>
          <FolderPlus className="size-4" />
          入纸匣
        </Button>
        <Button size="sm" variant="secondary" disabled={selectedCount === 0 || over} onClick={() => onEnqueue("download")}>
          <Download className="size-4" />
          下载
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} aria-label="完成">
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
