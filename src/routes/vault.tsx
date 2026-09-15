/**
 * 纸匣页：用浏览同一套拼版看已保存作品。
 *
 * 作用：按行补缝，封面保持原比例。交互仍是点进作品、悬停导出/移除。
 * 用法：侧栏入口。优先读用户文件夹原图。
 */
"use client";

import { Link } from "@/lib/kami-link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type MouseEvent } from "react";
import { unreadItems } from "@/lib/desk-unread";
import { useViewHistory } from "@/lib/view-history";
import { InfiniteSentinel } from "@/components/infinite-sentinel";
import { toast } from "sonner";
import { ArtworkCard } from "@/components/artwork-card";
import { EmptySheet } from "@/components/empty-sheet";
import { MasonryBoard } from "@/components/masonry-board";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MonthPicker } from "@/components/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SITE_LIST } from "@/lib/sites";
import { extFromNameOrType } from "@/lib/ugoira-meta";
import { authorKey, normalizeAuthorName } from "@/lib/author-name";
import { hasVaultCover, onThisDay } from "@/lib/storage/vault-profile";
import { formatBytes, cn } from "@/lib/utils";
import { exportVaultItem, previewFromFolder } from "@/lib/storage/persist-files";
import { useSettings } from "@/lib/store";
import { deleteVaultWork, getVaultBlob, listVault, type VaultMeta } from "@/lib/storage/vault";
import { forgetVaultKey } from "@/lib/storage/vault-index";
import { filterVaultItems, vaultAuthorOptions, vaultMonths, vaultTags, vaultTotals } from "@/lib/storage/vault-query";
import { VaultDedup } from "@/components/vault-dedup";
import { VaultFlipDialog } from "@/components/vault-flip";
import { useVaultCover } from "@/components/vault-cover";
import { listServerVault } from "@/lib/storage/vault-sync";
import type { Source, WorkCard } from "@/lib/types";

function cardFromMeta(item: VaultMeta, thumb: string, width?: number, height?: number): WorkCard {
  return {
    source: item.source,
    id: item.id,
    title: item.title,
    author: item.author,
    authorId: item.authorId,
    thumb,
    pageCount: item.pageCount,
    tags: item.tags,
    width,
    height,
  };
}

export function VaultPage() {
  // useSearchParams 会在静态生成时 CSR bailout；页级 Suspense 才能过 next build。
  return (
    <Suspense fallback={null}>
      <VaultPageInner />
    </Suspense>
  );
}

function VaultPageInner() {
  const folderLabel = useSettings((s) => s.folderLabel);
  const smartFolders = useSettings((s) => s.smartFolders);
  const addSmartFolder = useSettings((s) => s.addSmartFolder);
  const removeSmartFolder = useSettings((s) => s.removeSmartFolder);
  const authorAliases = useSettings((s) => s.authorAliases);
  const [all, setAll] = useState<VaultMeta[]>([]);
  const [text, setText] = useState("");
  const [source, setSource] = useState<Source | "all">("all");
  /** 选中态是作者簇键（authorKey），不再存 raw 名——同一画师的装饰变体共用一键。 */
  const [author, setAuthor] = useState("");
  const [tagsSel, setTagsSel] = useState<string[]>([]);
  const [month, setMonth] = useState("");
  const [dedupOpen, setDedupOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [ready, setReady] = useState(false);
  /** 今日去年：命中笺条后把列表过滤到那批藏品（点 × 恢复），瞬态不进智能文件夹。 */
  const [recallOnly, setRecallOnly] = useState(false);
  /** 未读纸叠：叠在 filterVaultItems / 今日去年之后，两芯片同时亮 = 交集；不进智能文件夹。 */
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [flipOpen, setFlipOpen] = useState(false);
  const searchParams = useSearchParams();
  const historyItems = useViewHistory((s) => s.items);

  // 案头深链：?recall=1 / ?unread=1 只当芯片初值，读完立刻从地址栏拿掉，避免分享带瞬时过滤。
  useEffect(() => {
    const recall = searchParams.get("recall") === "1";
    const unread = searchParams.get("unread") === "1";
    if (!recall && !unread) return;
    if (recall) setRecallOnly(true);
    if (unread) setUnreadOnly(true);
    const url = new URL(window.location.href);
    url.searchParams.delete("recall");
    url.searchParams.delete("unread");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [searchParams]);

  async function refresh() {
    let local: VaultMeta[] = [];
    try {
      local = await listVault();
    } catch {
      local = [];
    }
    // TD-38：listServerVault 与本地路径同防——远端异常退回本地目录，不冒泡
    let remote: Awaited<ReturnType<typeof listServerVault>> | null = null;
    try {
      remote = await listServerVault();
    } catch {
      remote = null;
    }
    const remoteItems = remote?.items ?? [];
    if (remoteItems.length > 0) {
      const map = new Map(remoteItems.map((item) => [item.key, item]));
      for (const item of local) {
        const prev = map.get(item.key);
        map.set(item.key, { ...item, hasFile: prev?.hasFile ?? item.hasFile });
      }
      setAll([...map.values()].sort((a, b) => b.savedAt - a.savedAt));
    } else {
      setAll(local);
    }
    setReady(true);
  }

  useEffect(() => {
    // TD-16：请求令牌防竞态——快速操作（删除/导出后刷新）时，旧响应不得覆盖新状态
    void refresh();
  }, []);

  // 今日去年：月-日相同、年份早于今年的藏品按年份降序分组（now 随 all 快照取一次）
  const recallGroups = useMemo(() => onThisDay(all, Date.now()), [all]);
  const recallTotal = recallGroups.reduce((n, group) => n + group.items.length, 0);
  const recallKeys = useMemo(
    () => new Set(recallGroups.flatMap((group) => group.items.map((item) => item.key))),
    [recallGroups],
  );
  const flipPool = useMemo(() => all.filter(hasVaultCover), [all]);
  const unreadKeys = useMemo(
    () => new Set(unreadItems(all, historyItems).map((x) => x.key)),
    [all, historyItems],
  );

  const items = useMemo(
    () => {
      const base = filterVaultItems(all, {
        text,
        source,
        authorKey: author || undefined,
        tags: tagsSel.length ? tagsSel : undefined,
        month: month || undefined,
      });
      // 今日去年 / 未读都叠在筛选之上：复用整页瀑布流；两芯片同时亮 = 交集
      const next = recallOnly && recallKeys.size > 0 ? base.filter((item) => recallKeys.has(item.key)) : base;
      return unreadOnly && unreadKeys.size > 0 ? next.filter((item) => unreadKeys.has(item.key)) : next;
    },
    [all, text, source, author, tagsSel, month, recallOnly, recallKeys, unreadOnly, unreadKeys],
  );
  const authors = useMemo(() => {
    const pool = source === "all" ? all : all.filter((item) => item.source === source);
    return vaultAuthorOptions(pool, authorAliases);
  }, [all, source, authorAliases]);
  /** 旧口径（智能库存的是 raw 名）→ 簇键：按 raw 名或规范名在当前纸匣里找一条。 */
  function authorKeyForName(name: string | undefined): string {
    const want = (name ?? "").trim();
    if (!want) return "";
    const hit = all.find((item) => item.author === want || normalizeAuthorName(item.author) === want);
    return hit ? authorKey(hit) : "";
  }
  const tagOptions = useMemo(() => vaultTags(all).slice(0, 24), [all]);
  const monthOptions = useMemo(() => vaultMonths(all), [all]);
  const filterActive = Boolean(text || (source !== "all" && source) || author || tagsSel.length || month);
  const totals = vaultTotals(items);
  // PER-3：大库分批渲染——首批 60 张，滚到底再续；过滤条件变化时回到首批
  const [visibleCount, setVisibleCount] = useState(60);
  const visible = items.slice(0, visibleCount);
  useEffect(() => {
    setVisibleCount(60);
  }, [text, source, author, tagsSel, month, recallOnly, unreadOnly]);
  const folderOnly = all.filter((item) => item.relativePath && item.hasFile === false).length;

  useEffect(() => {
    if (author && !authors.some((o) => o.key === author)) setAuthor("");
  }, [author, authors]);

  async function exportWork(item: VaultMeta) {
    const files: { blob: Blob; ext: string }[] = [];
    for (let i = 0; i < item.pageCount; i += 1) {
      const blob =
        (await previewFromFolder(item)) ||
        (await getVaultBlob(item.key, i, { localOnly: item.hasFile === false }));
      if (!blob) continue;
      files.push({ blob, ext: extFromNameOrType(undefined, blob.type) });
    }
    const result = await exportVaultItem(item, files);
    toast.success(result.folder ? "已按规则写入文件夹" : "已导出");
    await refresh();
  }

  async function exportZip() {
    // 有图才打：只收 hasFile 条目；缺图的由服务端记进包内 _skipped.json
    const keys = items.filter((item) => item.hasFile).map((item) => item.key);
    if (keys.length === 0) {
      toast.info("当前筛选里没有应用内原图可打包");
      return;
    }
    const truncated = keys.length > 400;
    const bytesTotal = items.filter((item) => keys.includes(item.key)).reduce((sum, item) => sum + (item.bytes || 0), 0);
    if (bytesTotal > 500 * 1024 * 1024) {
      toast.info(`预计 ${formatBytes(bytesTotal)}，建议用筛选缩小范围分批导出`);
    }
    setExporting(true);
    try {
      const res = await fetch("/api/vault/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          keys: truncated ? keys.slice(0, 400) : keys,
          // 分夹名要套用户别名（同一画师不再各开一夹），随请求带给无状态的服务端
          authorAliases: useSettings.getState().authorAliases,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `导出失败（${res.status}）`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kami-vault-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`已导出 ${formatBytes(blob.size)}${truncated ? `（超出 400 上限，仅含前 400 条）` : ""}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  async function removeWork(item: VaultMeta) {
    await deleteVaultWork(item.key);
    forgetVaultKey(item.key);
    await refresh();
    toast.success("已从目录移除");
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl tracking-tight md:text-4xl">纸匣</h1>
          <p className="mt-1 text-sm text-muted">
            {folderLabel
              ? `原图在「${folderLabel}」，这里只记路径和校验。`
              : "当前窗口不能挂文件夹时，图会暂存在本机纸匣库里，不设条数上限。"}
          </p>
          {folderOnly > 0 ? (
            <p className="mt-2 text-sm text-muted">
              {folderOnly} 条只有文件夹副本，应用内库没有像素。授权「存储」里的文件夹后才能预览封面；不是没保存。
            </p>
          ) : null}
          {/* 今日去年笺条：命中才递上来，点击把列表过滤到那批藏品 */}
          {recallTotal > 0 ? (
            <button
              type="button"
              className="kami-slip mt-3 cursor-pointer"
              onClick={() => setRecallOnly(true)}
            >
              {/* 命中可能不止去年（往年同月日都算），按最近一年措辞，不虚报年份 */}
              {recallGroups[0]?.year === new Date().getFullYear() - 1
                ? `去年的今天，你收了 ${recallTotal} 张`
                : `${recallGroups[0]?.year} 年的今天，你收了 ${recallTotal} 张`}
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setFlipOpen(true)} disabled={flipPool.length === 0}>
            随手翻一张
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void exportZip()} disabled={exporting || items.length === 0}>
            {exporting ? "打包中…" : "导出 ZIP"}
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link to="/vault/stats">统计</Link>
          </Button>
        </div>
      </header>

      {all.length > 0 ? (
        <div className="space-y-3">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="搜索标题、作者、标签、作品 ID 或路径"
          />
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip active={source === "all"} onClick={() => setSource("all")}>
              全部
            </FilterChip>
            {SITE_LIST.map((site) => (
              <FilterChip key={site.id} active={source === site.id} onClick={() => setSource(site.id)}>
                {site.label}
              </FilterChip>
            ))}
            {authors.length > 0 ? (
              <Select value={author || "all"} onValueChange={(v) => setAuthor(v === "all" ? "" : v)}>
                <SelectTrigger className="h-9 min-w-[9rem] rounded-full bg-elevated px-3.5">
                  <SelectValue placeholder="作者" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部作者</SelectItem>
                  {authors.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.name} · {option.count}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {monthOptions.length > 1 ? (
              <MonthPicker value={month} onChange={(m) => setMonth(m)} />
            ) : null}
            {recallTotal > 0 ? (
              <FilterChip active={recallOnly} onClick={() => setRecallOnly((v) => !v)}>
                {recallOnly ? "今日去年 ×" : "今日去年"}
              </FilterChip>
            ) : null}
            {unreadKeys.size > 0 ? (
              <FilterChip active={unreadOnly} onClick={() => setUnreadOnly((v) => !v)}>
                {unreadOnly ? "未读 ×" : "未读"}
              </FilterChip>
            ) : null}
            <span className="ml-auto text-xs tabular-nums text-subtle">
              {totals.count} 条 · {formatBytes(totals.bytes)}
            </span>
          </div>
          {tagOptions.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {tagOptions.map((tag) => {
                const active = tagsSel.includes(tag);
                return (
                  <FilterChip
                    key={tag}
                    active={active}
                    onClick={() =>
                      setTagsSel((prev) => (active ? prev.filter((t) => t !== tag) : [...prev, tag]))
                    }
                  >
                    {tag}
                  </FilterChip>
                );
              })}
              {tagsSel.length > 0 ? (
                <button type="button" className="text-xs text-muted underline-offset-2 hover:underline" onClick={() => setTagsSel([])}>
                  清空标签
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {smartFolders.map((folder) => (
              <span key={folder.id} className="inline-flex items-center gap-1 rounded-full bg-accent/15 pl-3 pr-1 text-sm">
                <button
                  type="button"
                  className="h-9 text-accent-fg"
                  onClick={() => {
                    setText(folder.query.text ?? "");
                    setSource(folder.query.source ?? "all");
                    // 新文件夹存簇键（authorKey）；旧文件夹按展示名解析，解析不出再回退原名匹配
                    setAuthor(folder.query.authorKey ?? authorKeyForName(folder.query.author ?? ""));
                    setTagsSel(folder.query.tags ?? []);
                    setMonth(folder.query.month ?? "");
                  }}
                >
                  {folder.name}
                </button>
                <button
                  type="button"
                  aria-label={`删除文件夹 ${folder.name}`}
                  className="grid size-7 place-items-center rounded-full text-muted hover:text-fg"
                  onClick={() => removeSmartFolder(folder.id)}
                >
                  ×
                </button>
              </span>
            ))}
            {filterActive ? (
              <button
                type="button"
                className="text-xs text-muted underline-offset-2 hover:underline"
                onClick={() => {
                  // 智能库存人类可读的簇展示名（跨设备 / 改别名后仍能按名解析回簇键）
                  const authorName = authors.find((o) => o.key === author)?.name ?? "";
                  const name = window.prompt("智能文件夹名字", `${tagsSel[0] ?? authorName ?? source}收藏`);
                  if (name)
                    addSmartFolder(name, {
                      text,
                      source,
                      author: authorName,
                      // 簇键随存：别名改过之后按名解析会失败，键才是稳定锚点
                      authorKey: author || undefined,
                      tags: tagsSel,
                      month: month || undefined,
                    });
                }}
              >
                存为智能文件夹
              </button>
            ) : null}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setDedupOpen((v) => !v)}>
              {dedupOpen ? "收起查重" : "查重"}
            </Button>
          </div>
        </div>
      ) : null}

      {dedupOpen ? <VaultDedup items={all} onChanged={() => void refresh()} /> : null}

      {!ready ? (
        <p className="text-sm text-muted">正在读取纸匣…</p>
      ) : all.length === 0 ? (
        <EmptySheet
          title="还是空的"
          hint="去浏览把喜欢的图收进来。"
          action={
            <Button asChild>
              <Link to="/browse">去浏览</Link>
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptySheet title="没有符合条件的记录。" hint="换个站点或作者再看。" />
      ) : (
        <MasonryBoard>
          {visible.map((item, i) => (
            <VaultCard
              key={item.key}
              item={item}
              index={i}
              onExport={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void exportWork(item);
              }}
              onDelete={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void removeWork(item);
              }}
            />
          ))}
          <InfiniteSentinel
            disabled={visible.length >= items.length}
            onVisible={() => setVisibleCount((n) => Math.min(n + 40, items.length))}
          />
        </MasonryBoard>
      )}

      <VaultFlipDialog items={all} aliases={authorAliases} open={flipOpen} onOpenChange={setFlipOpen} />
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 shrink-0 rounded-full px-3.5 text-sm",
        active ? "bg-accent text-accent-fg" : "bg-elevated text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function VaultCard({
  item,
  index,
  onExport,
  onDelete,
}: {
  item: VaultMeta;
  index: number;
  onExport: (e: MouseEvent) => void;
  onDelete: (e: MouseEvent) => void;
}) {
  // 取封面链路抽成 useVaultCover：随机翻牌对话框复用同一条（vault-cover.ts）
  const { thumb, width, height } = useVaultCover(item);

  return (
    <ArtworkCard
      work={cardFromMeta(item, thumb, width, height)}
      index={index}
      variant="vault"
      marks={item.replaced ? ["原图已被替换"] : undefined}
      onExport={onExport}
      onDelete={onDelete}
    />
  );
}
