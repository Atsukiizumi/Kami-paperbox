"use client";

/**
 * 纸匣筛选纸（钮 + 已选笺 + 桌面 Popover / 手机 Drawer）。
 *
 * 作用：关闭态只露出筛选钮、已选笺和计数；打开后同一份内芯选站点/作者/标签/月份/在匣里。
 * 用法：纸匣页搜索框下一行挂 <VaultFilter value onChange authors tagOptions totals showUnread showRecall />。
 * 为什么：页上不再摊站点 Chip 和作者 Select；桌面纸片、手机抽屉共用 VaultFilterBody，避免两套 JSX。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Drawer } from "vaul";
import { MonthPicker } from "@/components/date-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SITE_LIST } from "@/lib/sites";
import type { AuthorOption } from "@/lib/storage/vault-query.ts";
import {
  applySlipClear,
  clearVaultFilter,
  filterAuthorOptions,
  vaultFilterSlips,
  visibleVaultTags,
  type VaultFilterState,
} from "@/lib/vault-filter";
import { cn, formatBytes } from "@/lib/utils";

const MD_QUERY = "(min-width: 768px)";

export function FilterChip({
  active,
  onClick,
  children,
  "aria-label": ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        "h-9 shrink-0 rounded-full px-3.5 text-sm",
        active ? "bg-accent text-accent-fg" : "bg-elevated text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

export function VaultTagRow({
  tags,
  selected,
  onToggle,
  onClear,
}: {
  tags: string[];
  selected: string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ordered = useMemo(() => {
    const sel = new Set(selected);
    return [...tags.filter((t) => sel.has(t)), ...tags.filter((t) => !sel.has(t))];
  }, [tags, selected]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      setOverflows(el.scrollHeight > 40);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ordered]);

  return (
    <div className="flex items-start gap-2">
      <div
        ref={wrapRef}
        className={cn("flex min-w-0 flex-1 flex-wrap items-center gap-2", !open && overflows && "max-h-9 overflow-hidden")}
      >
        {ordered.map((tag) => {
          const active = selected.includes(tag);
          return (
            <FilterChip key={tag} active={active} onClick={() => onToggle(tag)}>
              {tag}
            </FilterChip>
          );
        })}
      </div>
      {selected.length > 0 ? (
        <button type="button" className="h-9 shrink-0 text-xs text-muted underline-offset-2 hover:underline" onClick={onClear}>
          清空
        </button>
      ) : null}
      {overflows ? (
        <button
          type="button"
          className="h-9 shrink-0 text-xs text-muted underline-offset-2 hover:underline"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "收起" : "展开"}
        </button>
      ) : null}
    </div>
  );
}

export function VaultFilterBody({
  value,
  onChange,
  authors,
  tagOptions,
  showUnread,
  showRecall,
  authorQuery,
  onAuthorQuery,
  tagQuery,
  onTagQuery,
  heading,
}: {
  value: VaultFilterState;
  onChange: (next: VaultFilterState) => void;
  authors: AuthorOption[];
  tagOptions: string[];
  showUnread: boolean;
  showRecall: boolean;
  authorQuery: string;
  onAuthorQuery: (q: string) => void;
  tagQuery: string;
  onTagQuery: (q: string) => void;
  heading: "dialog" | "page";
}) {
  const authorHits = filterAuthorOptions(authors, authorQuery);

  return (
    <div className="space-y-5 p-4">
      <header>
        {heading === "page" ? <h2 className="font-display text-base text-fg">筛选纸匣</h2> : null}
        <p className={cn("text-sm text-muted", heading === "page" && "mt-1")}>选出匣里要看的，不影响顶栏在刷哪个站。</p>
      </header>

      <section className="space-y-2">
        <p className="text-xs text-subtle">匣里的来源</p>
        <ToggleGroup
          type="single"
          value={value.source}
          onValueChange={(v) => v && onChange({ ...value, source: v as VaultFilterState["source"] })}
        >
          <ToggleGroupItem value="all">全部</ToggleGroupItem>
          {SITE_LIST.map((site) => (
            <ToggleGroupItem key={site.id} value={site.id}>
              {site.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </section>

      {authors.length > 0 ? (
        <section className="space-y-2">
          <p className="text-xs text-subtle">作者</p>
          <Input value={authorQuery} onChange={(e) => onAuthorQuery(e.target.value)} placeholder="按名字找作者" />
          {authorHits.length === 0 ? (
            <p className="text-sm text-muted">没有这个名字</p>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              {authorHits.map((option) => {
                const selected = option.key === value.authorKey;
                return (
                  <button
                    key={option.key}
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left",
                      selected && "bg-accent/15 text-fg",
                    )}
                    onClick={() => onChange({ ...value, authorKey: selected ? "" : option.key })}
                  >
                    <span className="truncate">{option.name}</span>
                    <span className="tabular-nums text-subtle">{option.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {tagOptions.length > 0 ? (
        <section className="space-y-2">
          <p className="text-xs text-subtle">标签</p>
          <Input value={tagQuery} onChange={(e) => onTagQuery(e.target.value)} placeholder="在标签里找" />
          <VaultTagRow
            tags={visibleVaultTags(tagOptions, value.tags, tagQuery)}
            selected={value.tags}
            onToggle={(tag) =>
              onChange({
                ...value,
                tags: value.tags.includes(tag) ? value.tags.filter((t) => t !== tag) : [...value.tags, tag],
              })
            }
            onClear={() => onChange({ ...value, tags: [] })}
          />
        </section>
      ) : null}

      <section className="space-y-2">
        <p className="text-xs text-subtle">收入月份</p>
        <MonthPicker value={value.month} onChange={(month) => onChange({ ...value, month })} />
      </section>

      {showUnread || showRecall ? (
        <section className="space-y-2">
          <p className="text-xs text-subtle">在匣里</p>
          <div className="flex flex-wrap items-center gap-2">
            {showUnread ? (
              <FilterChip
                active={value.unreadOnly}
                onClick={() => onChange({ ...value, unreadOnly: !value.unreadOnly })}
              >
                未读
              </FilterChip>
            ) : null}
            {showRecall ? (
              <FilterChip
                active={value.recallOnly}
                onClick={() => onChange({ ...value, recallOnly: !value.recallOnly })}
              >
                今日去年
              </FilterChip>
            ) : null}
          </div>
        </section>
      ) : null}

      <button
        type="button"
        className="text-sm text-muted underline-offset-2 hover:underline"
        onClick={() => {
          onChange(clearVaultFilter(value));
          onAuthorQuery("");
          onTagQuery("");
        }}
      >
        清空筛选
      </button>
    </div>
  );
}

export function VaultFilter({
  value,
  onChange,
  authors,
  tagOptions,
  totals,
  showUnread,
  showRecall,
}: {
  value: VaultFilterState;
  onChange: (next: VaultFilterState) => void;
  authors: AuthorOption[];
  tagOptions: string[];
  totals: { count: number; bytes: number };
  showUnread: boolean;
  showRecall: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [authorQuery, setAuthorQuery] = useState("");
  const [tagQuery, setTagQuery] = useState("");

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(MD_QUERY);
    const apply = () => setDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const authorName = authors.find((a) => a.key === value.authorKey)?.name ?? "";
  const slips = vaultFilterSlips(value, { authorName });
  const body = {
    value,
    onChange,
    authors,
    tagOptions,
    showUnread,
    showRecall,
    authorQuery,
    onAuthorQuery: setAuthorQuery,
    tagQuery,
    onTagQuery: setTagQuery,
  };

  const trigger = (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      className="rounded-full"
      aria-expanded={open}
      onClick={desktop ? undefined : () => setOpen(true)}
    >
      {slips.length > 0 ? `筛选 · ${slips.length}` : "筛选"}
    </Button>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {desktop ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent className="w-[min(24rem,calc(100vw-2rem))] p-0">
              <VaultFilterBody {...body} heading="page" />
            </PopoverContent>
          </Popover>
        ) : (
          trigger
        )}
        {slips.map((slip) => (
          <FilterChip
            key={`${slip.kind}:${slip.key}`}
            active
            aria-label={`去掉筛选：${slip.label}`}
            onClick={() => onChange(applySlipClear(value, slip))}
          >
            {slip.label}
          </FilterChip>
        ))}
        <span className="ml-auto text-xs tabular-nums text-subtle">
          {totals.count} 条 · {formatBytes(totals.bytes)}
        </span>
      </div>
      {desktop ? null : (
        <Drawer.Root open={open} onOpenChange={setOpen}>
          <Drawer.Portal>
            <Drawer.Overlay className="kami-veil-in fixed inset-0 z-50 bg-overlay" />
            <Drawer.Content className="kami-drawer-content">
              <div className="kami-drawer-grabber" aria-hidden />
              <Drawer.Title className="font-display text-base text-fg">筛选纸匣</Drawer.Title>
              <VaultFilterBody {...body} heading="dialog" />
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      )}
    </>
  );
}
