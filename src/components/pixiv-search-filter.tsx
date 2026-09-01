/**
 * Pixiv 搜索条件弹层。
 *
 * 作用：对照官网「搜索条件」——检索范围、作品类型、年龄、投稿时间、收藏数、横竖图、排序。
 * 用法：浏览页搜索框旁边；点「搜索」才把 draft 写回并重新拉。
 * 为什么：下拉一改就打接口太吵；收藏数 / 热门是 Premium 项，没开时 Pixiv 可能忽略。
 */
import { SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_PIXIV_SEARCH,
  PIXIV_SEARCH_AGES,
  PIXIV_SEARCH_BOOKMARKS,
  PIXIV_SEARCH_ORDERS,
  PIXIV_SEARCH_RATIO,
  PIXIV_SEARCH_SCOPES,
  PIXIV_SEARCH_TYPES,
  PIXIV_SEARCH_WHEN,
  countActivePixivSearch,
  type PixivSearchFilter,
} from "@/lib/pixiv-search";

type Props = {
  filter: PixivSearchFilter;
  safeMode: boolean;
  onApply: (next: PixivSearchFilter) => void;
};

function Row({
  label,
  value,
  options,
  onChange,
  disabledId,
}: {
  label: string;
  value: string;
  options: readonly { id: string; label: string }[];
  onChange: (id: string) => void;
  disabledId?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs text-muted">{label}</Label>
      </div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-10 w-full rounded-lg bg-elevated px-3 hover:bg-elevated">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[70]">
          {options.map((opt) => (
            <SelectItem key={opt.id} value={opt.id} disabled={opt.id === disabledId}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function PixivSearchFilter({ filter, safeMode, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filter);
  const active = countActivePixivSearch(filter);

  useEffect(() => {
    if (open) setDraft(filter);
  }, [open, filter]);

  function patch<K extends keyof PixivSearchFilter>(key: K, value: PixivSearchFilter[K]) {
    setDraft((cur) => ({ ...cur, [key]: value }));
  }

  function apply(next: PixivSearchFilter) {
    onApply(next);
    setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
        aria-label="搜索条件"
      >
        <SlidersHorizontal className="size-4" />
        搜索条件
        {active > 0 ? (
          <span className="rounded-full bg-accent/15 px-1.5 text-[10px] tabular-nums text-accent">{active}</span>
        ) : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(92vw,24rem)] space-y-4">
          <div>
            <DialogTitle>搜索条件</DialogTitle>
            <DialogDescription>对照 Pixiv 官网那一层。点搜索后才生效。</DialogDescription>
          </div>
          <div className="grid gap-3">
            <Row
              label="检索范围"
              value={draft.scope}
              options={PIXIV_SEARCH_SCOPES}
              onChange={(id) => patch("scope", id as PixivSearchFilter["scope"])}
            />
            <Row
              label="作品类型"
              value={draft.type}
              options={PIXIV_SEARCH_TYPES}
              onChange={(id) => patch("type", id as PixivSearchFilter["type"])}
            />
            <Row
              label="年龄限制"
              value={safeMode ? "safe" : draft.age}
              options={PIXIV_SEARCH_AGES}
              disabledId={safeMode ? "r18" : undefined}
              onChange={(id) => patch("age", id as PixivSearchFilter["age"])}
            />
            <Row
              label="投稿时间"
              value={draft.when}
              options={PIXIV_SEARCH_WHEN}
              onChange={(id) => patch("when", id as PixivSearchFilter["when"])}
            />
            <Row
              label="收藏数"
              value={draft.bookmarks}
              options={PIXIV_SEARCH_BOOKMARKS}
              onChange={(id) => patch("bookmarks", id as PixivSearchFilter["bookmarks"])}
            />
            <Row
              label="作品外形"
              value={draft.ratio}
              options={PIXIV_SEARCH_RATIO}
              onChange={(id) => patch("ratio", id as PixivSearchFilter["ratio"])}
            />
            <Row
              label="排序"
              value={draft.order}
              options={PIXIV_SEARCH_ORDERS}
              onChange={(id) => patch("order", id as PixivSearchFilter["order"])}
            />
          </div>
          <p className="text-[11px] leading-relaxed text-subtle">
            收藏数和热门排序是 Pixiv Premium 能力，没开时结果可能跟「不限 / 最新」一样。关掉顶栏 R-18 后才能选 R-18。
          </p>
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" onClick={() => setDraft(DEFAULT_PIXIV_SEARCH)}>
              清除检索条件
            </Button>
            <Button type="button" onClick={() => apply(draft)}>
              搜索
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
