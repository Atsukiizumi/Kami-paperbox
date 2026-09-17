"use client";

/**
 * 批量收藏浮动操作条（D）。
 *
 * 作用：选择模式下显示已选数、全选本页、清除与动作区；超上限禁用动作。
 * 用法：<BatchToolbar selectedCount total visibleCards onSelectAll onClear onEnqueue onDone />
 *      入队动作由父级执行（filterBatchable + enqueueWorks），本组件只报意图。
 *      传 children 替换默认「入纸匣 / 下载」动作区（纸匣批量整理用，可为空 =
 *      只读选择）；传 label 改可访问名；传 max={null} 解除 BATCH_MAX 上限。
 * 为什么：纸匣批量整理没有「入队」语义也不该被队列的 200 张上限卡住，但纸感
 *        语言（已选数 / 全选清除 / 完成退出的浮动纸条）要跟浏览批量同一条。
 */
import { type ReactNode } from "react";
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
  children,
  label = "批量收藏",
  max = BATCH_MAX,
}: {
  selectedCount: number;
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  /** 默认动作区的入队回调；传 children 时不需要。 */
  onEnqueue?: (kind: "vault" | "download") => void;
  onDone: () => void;
  /** 自定义动作区：给了（哪怕为空）就替换默认「入纸匣 / 下载」按钮。 */
  children?: ReactNode;
  /** role="toolbar" 的可访问名。 */
  label?: string;
  /** 选择上限；null = 不设上限（纸匣批量整理不受队列的 BATCH_MAX 约束）。 */
  max?: number | null;
}) {
  const over = max !== null && selectedCount > max;
  return (
    <div
      className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex flex-wrap items-center gap-2 rounded-xl border border-border/80 bg-bg/90 p-3 shadow-lg backdrop-blur-md md:bottom-6 md:left-auto md:right-6 md:max-w-md"
      role="toolbar"
      aria-label={label}
    >
      <span className="text-sm tabular-nums">
        已选 <b className={over ? "text-danger" : undefined}>{selectedCount}</b>
        {over ? ` / 上限 ${max}` : ""}
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={selectedCount >= total ? onClear : onSelectAll}
        disabled={total === 0}
      >
        {selectedCount >= total && total > 0 ? <Square className="size-4" /> : <CheckSquare className="size-4" />}
        {selectedCount >= total && total > 0 ? "清除" : "全选"}
      </Button>
      <div className="ml-auto flex items-center gap-2">
        {children === undefined ? (
          <>
            <Button size="sm" disabled={selectedCount === 0 || over} onClick={() => onEnqueue?.("vault")}>
              <FolderPlus className="size-4" />
              入纸匣
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={selectedCount === 0 || over}
              onClick={() => onEnqueue?.("download")}
            >
              <Download className="size-4" />
              下载
            </Button>
          </>
        ) : (
          children
        )}
        <Button size="sm" variant="ghost" onClick={onDone} aria-label="完成">
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
