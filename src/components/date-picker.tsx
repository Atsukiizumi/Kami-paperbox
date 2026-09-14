/**
 * 日期/月份选择（日历面板）。
 *
 * 作用：榜单日期（选一天）、纸匣按月筛选（选一月）这类日历入口，按钮弹出纸感日历。
 * 用法：<DatePicker value="2026-09-14" onChange={setBoardDate} />（空串=最新/不指定，
 *       面板内一键回到最新）；<MonthPicker value="2026-09" onChange={setMonth} />
 *       （空串=全部时间，选中月整月高亮）。
 * 为什么：原生 input[type=date] 各浏览器长相不一且与纸感脱节；DayPicker 可整体
 *       换皮，进场沿弹层家族同一套「纸片落下」动效（纸感质感批 PR3）。
 */
"use client";

import { CalendarDays, RotateCcw } from "lucide-react";
import { useState } from "react";
import { DayPicker } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import "react-day-picker/style.css";

function parseIsoDay(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function toIsoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function toIsoMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function labelOf(value: string): string {
  const d = parseIsoDay(value);
  if (!d) return "最新";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function DatePicker({
  value,
  onChange,
  align = "end",
  todayLabel = "最新",
}: {
  value: string;
  onChange: (iso: string) => void;
  /** 相对触发按钮的对齐，工具行里一般靠右。 */
  align?: "start" | "center" | "end";
  /** value 为空时的语义标签（榜单=最新一期；调用方自定义）。 */
  todayLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseIsoDay(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" className="ml-auto h-8 gap-1.5">
          <CalendarDays className="size-3.5 text-muted" />
          {value ? labelOf(value) : todayLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto p-0">
        <DayPicker
          mode="single"
          selected={selected}
          onSelect={(d) => {
            if (!d) return;
            onChange(toIsoDay(d));
            setOpen(false);
          }}
          className="kami-calendar"
          showOutsideDays={false}
          fixedWeeks
        />
        <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2">
          <span className="text-xs text-subtle">{value ? labelOf(value) : todayLabel}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            <RotateCcw className="size-3" />
            回到{todayLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** 按月筛选：选中月整月铺底高亮，点任一天即选中该月；空串=全部时间。 */
export function MonthPicker({
  value,
  onChange,
  align = "start",
  allLabel = "全部时间",
}: {
  value: string;
  onChange: (isoMonth: string) => void;
  align?: "start" | "center" | "end";
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = /^\d{4}-\d{2}$/.test(value) ? new Date(`${value}-01T00:00:00`) : undefined;
  const [month, setMonth] = useState<Date | undefined>(selected);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setMonth(selected ?? new Date());
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" className="h-9 min-w-[7.5rem] gap-1.5 rounded-full bg-elevated px-3.5">
          <CalendarDays className="size-3.5 text-muted" />
          {value || allLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto p-0">
        <DayPicker
          mode="single"
          month={month}
          onMonthChange={setMonth}
          selected={selected}
          onSelect={(d) => {
            if (!d) return;
            onChange(toIsoMonth(d));
            setOpen(false);
          }}
          modifiers={{
            inmonth: (d) => Boolean(selected) && toIsoMonth(d) === value,
          }}
          modifiersClassNames={{ inmonth: "kami-cal-inmonth" }}
          className="kami-calendar"
          showOutsideDays={false}
          fixedWeeks
        />
        <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2">
          <span className="text-xs text-subtle">{value || allLabel}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            <RotateCcw className="size-3" />
            {allLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
