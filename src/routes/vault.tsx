/**
 * 纸匣页：用浏览同一套拼版看已保存作品。
 *
 * 作用：按行补缝，封面保持原比例。交互仍是点进作品、悬停导出/移除；
 *      「选择」进批量模式后点卡是勾选，工具条给批量加/删标签（改 tags 原文，
 *      删除按展示名归一匹配、变体同删，见 vault-tag-alias.ts）。
 * 用法：侧栏入口。优先读用户文件夹原图。
 */
"use client";

import { Link } from "@/lib/kami-link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { unreadItems } from "@/lib/desk-unread";
import { useViewHistory } from "@/lib/view-history";
import { InfiniteSentinel } from "@/components/infinite-sentinel";
import { toast } from "sonner";
import { AddToCollectionPanel, CollectionDetail, CollectionsBar, VaultCard } from "@/components/collections-bar";
import { EmptySheet } from "@/components/empty-sheet";
import { MasonryBoard } from "@/components/masonry-board";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { VaultFilter } from "@/components/vault-filter";
import { BatchToolbar } from "@/components/batch-toolbar";
import { useBatchSelection } from "@/components/use-batch-selection";
import { VaultBatchActions, type BatchTagEntry } from "@/components/vault-batch-tags";
import { extFromNameOrType } from "@/lib/ugoira-meta";
import { authorKey, normalizeAuthorName } from "@/lib/author-name";
import { hasVaultCover, onThisDay } from "@/lib/storage/vault-profile";
import { formatBytes } from "@/lib/utils";
import { exportVaultItem, previewFromFolder } from "@/lib/storage/persist-files";
import { isBooru } from "@/lib/sites";
import { lexiconTokens } from "@/lib/tag-lexicon";
import { applyTagAlias } from "@/lib/vault-tag-alias";
import { useSettings } from "@/lib/store";
import { deleteVaultWork, getVaultBlob, listVault, putVaultMeta, type VaultMeta } from "@/lib/storage/vault";
import { forgetVaultKey } from "@/lib/storage/vault-index";
import { filterVaultItems, mergeVaultItems, vaultAuthorOptions, vaultTags, vaultTotals } from "@/lib/storage/vault-query";
import { VaultDedup } from "@/components/vault-dedup";
import { VaultFlipDialog } from "@/components/vault-flip";
import { listServerVault, listServerTrash, type ServerTrashItem } from "@/lib/storage/vault-sync";
import { VaultTrashDialog } from "@/components/vault-trash";
import { EMPTY_VAULT_FILTER, vaultQueryFlag, type VaultFilterState } from "@/lib/vault-filter";

export function VaultPage() {
  // useSearchParams 会在静态生成时 CSR bailout；页级 Suspense 才能过 next build。
  return (
    <Suspense fallback={<p className="text-sm text-muted">正在读取纸匣…</p>}>
      <VaultPageInner />
    </Suspense>
  );
}

function VaultPageInner() {
  const folderLabel = useSettings((s) => s.folderLabel);
  const smartFolders = useSettings((s) => s.smartFolders);
  const addSmartFolder = useSettings((s) => s.addSmartFolder);
  const removeSmartFolder = useSettings((s) => s.removeSmartFolder);
  const collections = useSettings((s) => s.collections);
  const authorAliases = useSettings((s) => s.authorAliases);
  // 标签别名（变体原文 → 规范名）：筛选 / 搜索 / 卡片展示统一从这里过（标签整理）
  const tagAliases = useSettings((s) => s.tagAliases);
  const [all, setAll] = useState<VaultMeta[]>([]);
  const [text, setText] = useState("");
  /**
   * 筛选纸一张纸管全部条件（站点/作者/标签/月份/未读/今日去年）；作者键是簇键（authorKey），
   * 同一画师的装饰变体共用一键。未读 / 今日去年是瞬态芯片：叠在筛选之上，两芯片同亮 = 交集，不进智能文件夹。
   */
  const [filter, setFilter] = useState<VaultFilterState>(EMPTY_VAULT_FILTER);
  const [dedupOpen, setDedupOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [ready, setReady] = useState(false);
  const [flipOpen, setFlipOpen] = useState(false);
  // 纸篓（软删除回收站）：null = 服务端不可达（纸篓是纯服务端能力，入口隐身）
  const [trashOpen, setTrashOpen] = useState(false);
  const [trash, setTrash] = useState<{ items: ServerTrashItem[]; bytes: number } | null>(null);
  // 批量选择（只读勾选；写操作见 applyBatchTags）：选择与筛选/搜索互不干扰
  const sel = useBatchSelection();
  // 手工合集详情开关态：非 null 时正文区整体换成合集详情（与批量选择互斥，进入即退选）
  const [openCollectionId, setOpenCollectionId] = useState<string | null>(null);
  // 单卡「加入合集」弹层目标：null = 关；选择模式下不走单卡入口（工具条负责）
  const [addTarget, setAddTarget] = useState<VaultMeta | null>(null);
  const openCollection = openCollectionId ? collections.find((c) => c.id === openCollectionId) : undefined;
  const searchParams = useSearchParams();
  const historyItems = useViewHistory((s) => s.items);

  // 案头深链：?recall=1 / ?unread=1 / ?replaced=1 只当芯片初值，读完立刻从地址栏拿掉，避免分享带瞬时过滤。
  useEffect(() => {
    const recall = searchParams.get("recall") === "1";
    const unread = searchParams.get("unread") === "1";
    const replaced = searchParams.get("replaced") === "1";
    if (!recall && !unread && !replaced) return;
    setFilter((f) => ({
      ...f,
      recallOnly: recall || f.recallOnly,
      unreadOnly: unread || f.unreadOnly,
      replacedOnly: replaced || f.replacedOnly,
    }));
    const url = new URL(window.location.href);
    url.searchParams.delete("recall");
    url.searchParams.delete("unread");
    url.searchParams.delete("replaced");
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
    // 按 key 合并、本地覆盖优先（mergeVaultItems）：本地 meta 编辑（批量标签等）不被远端刷掉
    setAll(mergeVaultItems(local, remoteItems));
    setReady(true);
  }

  useEffect(() => {
    // TD-16：请求令牌防竞态——快速操作（删除/导出后刷新）时，旧响应不得覆盖新状态
    void refresh();
  }, []);

  // 纸篓计数：进页拉一次；删除/还原/清空后经 refreshTrash 回填。失败（无服务端）保持 null 隐身。
  const refreshTrash = useCallback(async () => {
    const list = await listServerTrash();
    setTrash(list ? { items: list.items, bytes: list.bytes } : null);
  }, []);

  useEffect(() => {
    void refreshTrash();
  }, [refreshTrash]);

  /** 纸篓动作后的统一回填：纸篓计数 + 纸匣列表（还原要回到匣内）。 */
  function onTrashChanged() {
    void refreshTrash();
    void refresh();
  }

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
  // 合集软失效过滤与封面解析共用：vaultKeys = 当前纸匣里仍存在的 key 集
  const vaultKeys = useMemo(() => new Set(all.map((item) => item.key)), [all]);
  const metasByKey = useMemo(() => new Map(all.map((item) => [item.key, item])), [all]);

  const items = useMemo(
    () => {
      const base = filterVaultItems(all, {
        text,
        source: filter.source,
        authorKey: filter.authorKey || undefined,
        tags: filter.tags.length ? filter.tags : undefined,
        month: filter.month || undefined,
        tagAliases,
        ai: vaultQueryFlag(filter.ai),
        r18: vaultQueryFlag(filter.r18),
        replaced: vaultQueryFlag(filter.replacedOnly),
      });
      // 今日去年 / 未读都叠在筛选之上：复用整页瀑布流；两芯片同时亮 = 交集
      const next = filter.recallOnly && recallKeys.size > 0 ? base.filter((item) => recallKeys.has(item.key)) : base;
      return filter.unreadOnly && unreadKeys.size > 0 ? next.filter((item) => unreadKeys.has(item.key)) : next;
    },
    [all, text, filter, tagAliases, recallKeys, unreadKeys],
  );
  const authors = useMemo(() => {
    const pool = filter.source === "all" ? all : all.filter((item) => item.source === filter.source);
    return vaultAuthorOptions(pool, authorAliases);
  }, [all, filter.source, authorAliases]);
  /** 旧口径（智能库存的是 raw 名）→ 簇键：按 raw 名或规范名在当前纸匣里找一条。 */
  function authorKeyForName(name: string | undefined): string {
    const want = (name ?? "").trim();
    if (!want) return "";
    const hit = all.find((item) => item.author === want || normalizeAuthorName(item.author) === want);
    return hit ? authorKey(hit) : "";
  }
  // 全量标签交给筛选纸：visibleVaultTags 负责 40 条上限、选中置顶与纸内搜索，页上不再摊 24 个。
  // 归一后变体并入规范名（计数合并压排序）：同一事物在纸里只剩一笺。
  const tagOptions = useMemo(() => vaultTags(all, tagAliases), [all, tagAliases]);
  // booru 藏品出现过的归一 token 集：筛选笺只对「booru 侧真实出现过」的笺判未翻，
  // 纯 pixiv/fanbox 笺（含小写英文）不得借 booru 词表误标。
  const booruTagKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const item of all) {
      if (!isBooru(item.source)) continue;
      for (const tag of item.tags)
        for (const t of lexiconTokens(applyTagAlias(tag, tagAliases))) keys.add(t);
    }
    return keys;
  }, [all, tagAliases]);
  const filterActive = Boolean(text || filter.source !== "all" || filter.authorKey || filter.tags.length || filter.month);
  const totals = vaultTotals(items);
  // PER-3：大库分批渲染——首批 60 张，滚到底再续；过滤条件变化时回到首批
  const [visibleCount, setVisibleCount] = useState(60);
  const visible = items.slice(0, visibleCount);
  useEffect(() => {
    setVisibleCount(60);
  }, [text, filter]);
  const folderOnly = all.filter((item) => item.relativePath && item.hasFile === false).length;

  useEffect(() => {
    if (filter.authorKey && !authors.some((o) => o.key === filter.authorKey)) {
      setFilter((f) => ({ ...f, authorKey: "" }));
    }
  }, [filter.authorKey, authors]);

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
    // 软删除进纸篓：IDB 副本一并忘掉（还原后从服务端列表回来），文件还在盘上
    await deleteVaultWork(item.key);
    forgetVaultKey(item.key);
    await refresh();
    void refreshTrash();
    toast.success("已放进纸篓（可在纸篓里放回去）");
  }

  // 批量标签的选中集合：按 key 从全量目录取（改筛选不丢已选，动作也不漏隐藏中的）
  const selectedItems = useMemo(() => all.filter((item) => sel.selected.has(item.key)), [all, sel.selected]);

  // 批量加/删标签写回：只动 tags 数组、逐张 putVaultMeta 落本地 IDB；
  // refresh 的合并按 key 本地覆盖优先（mergeVaultItems），编辑不会被远端刷掉（测试锁）
  async function applyBatchTags(kind: "add" | "remove", tag: string, entries: BatchTagEntry[]) {
    if (entries.length === 0) return;
    try {
      for (const { meta, tags } of entries) {
        await putVaultMeta({ ...meta, tags });
      }
      await refresh();
      toast.success(
        kind === "add"
          ? `已给 ${entries.length} 张加标签「${tag}」`
          : `已从 ${entries.length} 张移除标签「${tag}」`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "批量标签没写完，稍后再试");
      await refresh(); // 部分写入也要让页面回到真实状态
    }
  }

  // 加入合集的执行侧：只动设置段（不写 IDB），拒因提示按 addToCollection 返回值出
  function addKeysToCollection(collectionId: string, keys: string[]) {
    const s = useSettings.getState();
    const target = s.collections.find((c) => c.id === collectionId);
    if (!target) return;
    const added = s.addToCollection(collectionId, keys);
    if (added === "full") toast.error(`「${target.name}」最多 500 项，这批没有加入`);
    else if (added === 0) toast.info(`所选藏品都已在「${target.name}」里`);
    else toast.success(`已把 ${added} 张加入「${target.name}」`);
  }

  function createCollectionWithKeys(name: string, keys: string[]) {
    const created = useSettings.getState().createCollection(name, keys);
    if (!created.ok) {
      toast.error(created.reason === "full" ? "最多 50 个合集" : "合集名字不能为空");
      return;
    }
    const target = useSettings.getState().collections.find((c) => c.id === created.id);
    toast.success(`已创建合集「${target?.name ?? name}」，加入 ${keys.length} 张`);
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
              onClick={() => setFilter((f) => ({ ...f, recallOnly: true }))}
            >
              {/* 命中可能不止去年（往年同月日都算），按最近一年措辞，不虚报年份 */}
              {recallGroups[0]?.year === new Date().getFullYear() - 1
                ? `去年的今天，你收了 ${recallTotal} 张`
                : `${recallGroups[0]?.year} 年的今天，你收了 ${recallTotal} 张`}
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {trash ? (
            <Button
              size="sm"
              variant="ghost"
              title={`纸篓 ${trash.items.length} 张 · 约 ${formatBytes(trash.bytes)}`}
              onClick={() => setTrashOpen(true)}
            >
              纸篓
              {trash.items.length > 0 ? (
                <span className="ml-1.5 rounded-full bg-elevated px-1.5 py-px text-xs text-subtle">
                  {trash.items.length}
                </span>
              ) : null}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setFlipOpen(true)} disabled={flipPool.length === 0}>
            随手翻一张
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void exportZip()} disabled={exporting || items.length === 0}>
            {exporting ? "打包中…" : "导出 ZIP"}
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link to="/vault/stats">统计</Link>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              // 与「存为智能文件夹」同一 window.prompt 交互，不另做命名弹层
              const name = window.prompt("合集名字", "");
              if (!name || !name.trim()) return;
              const created = useSettings.getState().createCollection(name);
              if (!created.ok) {
                toast.error(created.reason === "full" ? "最多 50 个合集" : "合集名字不能为空");
              }
            }}
          >
            新建合集
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
          <VaultFilter
            value={filter}
            onChange={setFilter}
            authors={authors}
            tagOptions={tagOptions}
            booruTagKeys={booruTagKeys}
            totals={totals}
            showUnread={unreadKeys.size > 0}
            showRecall={recallTotal > 0}
            showReplaced={all.some((i) => i.replaced)}
          />
          <div className="flex flex-wrap items-center gap-2">
            {smartFolders.map((folder) => (
              <span key={folder.id} className="inline-flex items-center gap-1 rounded-full bg-accent/15 pl-3 pr-1 text-sm">
                <button
                  type="button"
                  className="h-9 text-accent-fg"
                  onClick={() => {
                    setText(folder.query.text ?? "");
                    // 新文件夹存簇键（authorKey）；旧文件夹按展示名解析，解析不出再回退原名匹配
                    setFilter((f) => ({
                      ...f,
                      source: folder.query.source ?? "all",
                      authorKey: folder.query.authorKey ?? authorKeyForName(folder.query.author ?? ""),
                      tags: folder.query.tags ?? [],
                      month: folder.query.month ?? "",
                    }));
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
                  const authorName = authors.find((o) => o.key === filter.authorKey)?.name ?? "";
                  const name = window.prompt("智能文件夹名字", `${filter.tags[0] ?? authorName ?? filter.source}收藏`);
                  if (name)
                    addSmartFolder(name, {
                      text,
                      source: filter.source,
                      author: authorName,
                      // 簇键随存：别名改过之后按名解析会失败，键才是稳定锚点
                      authorKey: filter.authorKey || undefined,
                      tags: filter.tags,
                      month: filter.month || undefined,
                    });
                }}
              >
                存为智能文件夹
              </button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={sel.toggleActive} disabled={items.length === 0}>
              {sel.active ? "退出选择" : "选择"}
            </Button>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setDedupOpen((v) => !v)}>
              {dedupOpen ? "收起查重" : "查重"}
            </Button>
          </div>
          {/* 合集笺行：智能文件夹笺的下一排；空合集零占位 */}
          {collections.length > 0 ? (
            <CollectionsBar
              collections={collections}
              vaultKeys={vaultKeys}
              metas={metasByKey}
              onOpen={(id) => {
                sel.exit();
                setOpenCollectionId(id);
              }}
            />
          ) : null}
        </div>
      ) : null}

      {dedupOpen ? <VaultDedup items={all} onChanged={() => void refresh()} /> : null}

      {!ready ? (
        <p className="text-sm text-muted">正在读取纸匣…</p>
      ) : openCollection ? (
        // 合集详情：正文区整体切换，不与批量选择态叠加（进入详情时已 sel.exit()）
        <CollectionDetail
          collection={openCollection}
          vaultKeys={vaultKeys}
          metas={metasByKey}
          tagAliases={tagAliases}
          onBack={() => setOpenCollectionId(null)}
        />
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
              tagAliases={tagAliases}
              selection={
                sel.active
                  ? { checked: sel.selected.has(item.key), onToggle: () => sel.toggle(item.key) }
                  : undefined
              }
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
              // 选择模式下不传：勾选卡用工具条入口，语义不重复
              onAddToCollection={sel.active ? undefined : () => setAddTarget(item)}
            />
          ))}
          <InfiniteSentinel
            disabled={visible.length >= items.length}
            onVisible={() => setVisibleCount((n) => Math.min(n + 40, items.length))}
          />
        </MasonryBoard>
      )}

      {sel.active ? (
        <BatchToolbar
          label="批量整理"
          selectedCount={sel.selected.size}
          total={items.length}
          max={null}
          onSelectAll={() => sel.selectAll(items.map((item) => item.key))}
          onClear={sel.clear}
          onDone={sel.exit}
        >
          <VaultBatchActions
            selectedItems={selectedItems}
            tagOptions={tagOptions}
            tagAliases={tagAliases}
            onApply={(kind, tag, entries) => void applyBatchTags(kind, tag, entries)}
            collections={collections}
            vaultKeys={vaultKeys}
            onAddToCollection={(collectionId) =>
              addKeysToCollection(
                collectionId,
                selectedItems.map((item) => item.key),
              )
            }
            onCreateCollection={(name) =>
              createCollectionWithKeys(
                name,
                selectedItems.map((item) => item.key),
              )
            }
          />
        </BatchToolbar>
      ) : null}

      {addTarget ? (
        // 单卡「加入合集」弹层：与批量工具条共用 AddToCollectionPanel 内容
        <Dialog open onOpenChange={(o) => { if (!o) setAddTarget(null); }}>
          <DialogContent className="w-[min(92vw,20rem)]">
            <DialogTitle>加入合集</DialogTitle>
            <DialogDescription>把「{addTarget.title}」收进一个合集。</DialogDescription>
            <div className="mt-3">
              <AddToCollectionPanel
                collections={collections}
                vaultKeys={vaultKeys}
                onPick={(collectionId) => {
                  addKeysToCollection(collectionId, [addTarget.key]);
                  setAddTarget(null);
                }}
                onCreate={(name) => {
                  createCollectionWithKeys(name, [addTarget.key]);
                  setAddTarget(null);
                }}
              />
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      <VaultFlipDialog items={all} aliases={authorAliases} open={flipOpen} onOpenChange={setFlipOpen} />
      {trash ? (
        <VaultTrashDialog
          open={trashOpen}
          onOpenChange={setTrashOpen}
          items={trash.items}
          bytes={trash.bytes}
          onChanged={onTrashChanged}
        />
      ) : null}
    </div>
  );
}
