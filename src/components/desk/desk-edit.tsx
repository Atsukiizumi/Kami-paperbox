"use client";

/**
 * 案头编排模式的编辑部件（布局引擎 P1）。
 *
 * 作用：编辑态的三件套 UI——槽位框（占宽切换 + 拖放目标）、模块卡（把手/
 *      下场/键盘选中）、底部编排条（版式架 + 托盘 + 存为版式/恢复默认/完成）。
 * 用法：desk.tsx 持 draft 状态并接线；本文件只出不认 store 的展示组件。
 * 为什么：真实页面即画布（所见即所得），编辑件全部受控无副作用，
 *        DnD 用原生 HTML5（鼠标优先），键盘方向键做兜底。
 */
import { useEffect, useState, type DragEvent, type ReactNode } from "react";
import { GripVertical, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DESK_MODULE_LABELS, type DeskModuleId, type DeskPreset, type DeskSlot } from "@/lib/desk-layout";
import { cn } from "@/lib/utils";

/** 拖拽载荷：模块 id + 出发槽/序（drop 时算搬移）。 */
export type DeskDrag = { moduleId: DeskModuleId; fromSlot: number; fromIndex: number };

/** 编辑槽位框：占宽段选 + 虚线容器 + drop 目标高亮；children = 模块卡列表。 */
export function DeskEditSlot({
  slot,
  index,
  dropping,
  onDragOver,
  onDrop,
  onDragLeave,
  onSpan,
  children,
}: {
  slot: DeskSlot;
  index: number;
  dropping: boolean;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent, slotIndex: number) => void;
  onDragLeave: () => void;
  onSpan: (slotIndex: number, span: 1 | 2 | 3) => void;
  children: ReactNode;
}) {
  return (
    <div
      data-desk-slot={index}
      className={cn(
        "kami-desk-slot relative flex flex-col gap-3 rounded-2xl border border-dashed border-accent/40 p-2 transition-colors",
        dropping && "border-accent bg-accent/5",
        slot.span === 1 ? "lg:col-span-1" : slot.span === 2 ? "lg:col-span-2" : "lg:col-span-3",
      )}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, index)}
      onDragLeave={onDragLeave}
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-xs tabular-nums text-subtle">槽 {index + 1}</span>
        <div className="flex rounded-md bg-surface p-0.5" role="group" aria-label={`槽 ${index + 1} 占宽`}>
          {([1, 2, 3] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={slot.span === v}
              onClick={() => onSpan(index, v)}
              className={cn(
                "rounded px-2 py-0.5 text-xs tabular-nums transition-colors",
                slot.span === v ? "bg-elevated text-fg" : "text-muted hover:text-fg",
              )}
            >
              {v === 1 ? "⅓" : v === 2 ? "⅔" : "满"}
            </button>
          ))}
        </div>
      </div>
      {children}
      <p className="px-1 text-[11px] text-subtle">把模块拖到这里</p>
    </div>
  );
}

/** 模块卡：真实模块预览（pointer-events 由 CSS 关掉）+ 把手 + 下场 + 选中态。 */
export function DeskEditCard({
  moduleId,
  selected,
  onSelect,
  onRemove,
  onDragStart,
  onDragEnd,
  children,
}: {
  moduleId: DeskModuleId;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  children: ReactNode;
}) {
  return (
    <div
      data-desk-edit-card
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group relative min-h-24 cursor-grab rounded-xl transition-shadow",
        selected && "ring-2 ring-accent ring-offset-2 ring-offset-bg",
      )}
    >
      <div data-desk-module>{children}</div>
      <span className="absolute left-1.5 top-1.5 z-10 flex items-center gap-1 rounded-md bg-bg/85 px-1.5 py-0.5 text-xs text-muted shadow-sm">
        <GripVertical className="size-3.5" aria-hidden />
        {DESK_MODULE_LABELS[moduleId]}
      </span>
      <button
        type="button"
        aria-label={`收起${DESK_MODULE_LABELS[moduleId]}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute right-1.5 top-1.5 z-10 grid size-6 place-items-center rounded-md bg-bg/85 text-muted opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/** 底部编排条：版式架 + 托盘 + 动作。纯受控。 */
export function DeskEditBar({
  presets,
  activePresetId,
  dirty,
  tray,
  headerSlip,
  onPickPreset,
  onToggleHeaderSlip,
  onTrayAdd,
  onAddSlot,
  onSaveAs,
  onReset,
  onDone,
}: {
  presets: DeskPreset[];
  activePresetId: string;
  dirty: boolean;
  tray: DeskModuleId[];
  headerSlip: boolean;
  onPickPreset: (id: string) => void;
  onToggleHeaderSlip: () => void;
  onTrayAdd: (id: DeskModuleId) => void;
  onAddSlot: () => void;
  onSaveAs: (name: string) => void;
  onReset: () => void;
  onDone: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-5">
      <div className="flex max-w-full flex-wrap items-center gap-2 rounded-2xl border border-border/80 bg-surface/95 p-2.5 shadow-[var(--shadow-paper-3)] backdrop-blur-md">
        <div className="flex max-w-full items-center gap-1.5 overflow-x-auto">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPickPreset(p.id)}
              aria-pressed={p.id === activePresetId}
              className={cn(
                "shrink-0 rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                p.id === activePresetId ? "bg-elevated text-fg ring-1 ring-accent" : "bg-bg text-muted hover:text-fg",
              )}
            >
              {p.name}
            </button>
          ))}
          <button
            type="button"
            onClick={onAddSlot}
            className="shrink-0 rounded-lg bg-bg px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-fg"
          >
            <Plus className="mr-0.5 inline size-3.5" aria-hidden />槽
          </button>
        </div>
        {tray.length > 0 ? (
          <div className="flex items-center gap-1.5 border-l border-border/60 pl-2">
            <span className="text-[11px] text-subtle">不上场</span>
            {tray.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => onTrayAdd(id)}
                className="shrink-0 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-accent hover:text-fg"
              >
                {DESK_MODULE_LABELS[id]}
              </button>
            ))}
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleHeaderSlip}
            aria-pressed={headerSlip}
            className={cn(
              "hidden shrink-0 rounded-lg px-2.5 py-1.5 text-xs transition-colors sm:inline-flex",
              headerSlip ? "bg-elevated text-fg" : "bg-bg text-muted hover:text-fg",
            )}
          >
            去年今日笺
          </button>
          <Button type="button" size="sm" variant="ghost" onClick={onReset}>
            恢复默认
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              onSaveAs("");
            }}
          >
            存为版式
          </Button>
          <Button type="button" size="sm" onClick={onDone}>
            {dirty ? "完成并保存" : "完成"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 存为版式命名框。 */
export function DeskSaveAsDialog({
  open,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (open) setName("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(v) => (v ? undefined : onCancel())}>
      <DialogContent className="w-[min(92vw,22rem)]">
        <DialogTitle>存为版式</DialogTitle>
        <DialogDescription>给当前摆法起个名字，之后随时一键切回。</DialogDescription>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onSubmit(name.trim());
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="比如：夜读版式" maxLength={24} autoFocus />
          <Button type="submit" size="sm" disabled={!name.trim()}>
            保存
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
