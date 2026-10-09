"use client";

/**
 * 手工合集：纸匣页内分区（列表笺 + 详情 + 加入面板）。
 *
 * 作用：CollectionsBar 渲染一排合集笺（封面缩略 + 名称 + 有效成员计数）；
 *      CollectionDetail 复用纸匣同套 MasonryBoard 拼版做详情网格，成员管理
 *      （重命名 / 换封面 / 整理顺序 / 移除成员 / 删除合集）全收在详情页；
 *      AddToCollectionPanel 是「加入合集」弹层内容，批量工具条与单卡弹层共用。
 * 用法：vault.tsx 挂点——bar 挂智能文件夹笺下一排（空合集零占位）；
 *      正文区在 openCollection 非 null 时整体换 CollectionDetail；弹层容器由
 *      调用方提供（工具条用 Popover、单卡用 Dialog），面板只发 onPick / onCreate。
 * 为什么：软失效只在渲染期过滤（collectionMembers），存储不清洗——重新收藏
 *      同作品生成同 key，失配项自然恢复；详情卡与纸匣主网格共用同一套
 *      cardFromMeta / VaultCard，封面链与拼版口径不会漂移。
 */
import { useState, type MouseEvent } from "react";
import { ArrowDown, ArrowUp, ArrowUpToLine, X } from "lucide-react";
import { toast } from "sonner";
import { ArtworkCard } from "@/components/artwork-card";
import { EmptySheet } from "@/components/empty-sheet";
import { MasonryBoard } from "@/components/masonry-board";
import { ProxiedImg } from "@/components/proxied-img";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useVaultCover } from "@/components/vault-cover";
import { cardAspect } from "@/lib/card-aspect";
import { collectionMembers, type Collection } from "@/lib/collection";
import { useSettings } from "@/lib/store";
import type { VaultMeta } from "@/lib/storage/vault";
import { applyTagAliases } from "@/lib/vault-tag-alias";
import type { WorkCard } from "@/lib/types";
import { cn } from "@/lib/utils";

// 标签过别名层（trim + 单跳映射 + 去重）：同图双变体只显示一次规范名，落盘原文不动
function cardFromMeta(item: VaultMeta, thumb: string, tagAliases: Record<string, string>, width?: number, height?: number): WorkCard {
  return {
    source: item.source,
    id: item.id,
    title: item.title,
    author: item.author,
    authorId: item.authorId,
    thumb,
    pageCount: item.pageCount,
    tags: applyTagAliases(item.tags, tagAliases),
    aiType: item.aiType,
    // 遮盖 / R-18 笺在纸匣面的判定依据（不映射则纸匣 R-18 永远不遮，trellis-check P1-3）
    xRestrict: item.xRestrict,
    rating: item.rating,
    width,
    height,
  };
}

/** 纸匣卡（主网格与合集详情共用）：封面链 useVaultCover → cardFromMeta → ArtworkCard。 */
export function VaultCard({
  item,
  index,
  tagAliases,
  selection,
  onExport,
  onDelete,
  onAddToCollection,
}: {
  item: VaultMeta;
  index: number;
  tagAliases: Record<string, string>;
  selection?: { checked: boolean; onToggle: () => void };
  onExport?: (e: MouseEvent) => void;
  onDelete?: (e: MouseEvent) => void;
  onAddToCollection?: () => void;
}) {
  // 取封面链路抽成 useVaultCover：随机翻牌对话框复用同一条（vault-cover.ts）
  const { thumb, width, height } = useVaultCover(item);

  return (
    <ArtworkCard
      work={cardFromMeta(item, thumb, tagAliases, width, height)}
      index={index}
      variant="vault"
      marks={item.replaced ? ["原图已被替换"] : undefined}
      // 选择模式下点整卡即勾选、不进详情；悬停导出/移除托保持原样
      selection={selection ? { ...selection, toggleOnCardClick: true } : undefined}
      onExport={onExport}
      onDelete={onDelete}
      onAddToCollection={onAddToCollection}
    />
  );
}

/** 显式封面已不是有效成员时跟随第一张（软失效口径，存储不清洗）。 */
function coverMetaOf(
  collection: Collection,
  vaultKeys: ReadonlySet<string>,
  metas: ReadonlyMap<string, VaultMeta>,
): VaultMeta | undefined {
  const members = collectionMembers(collection, vaultKeys);
  const key = collection.coverKey && members.includes(collection.coverKey) ? collection.coverKey : members[0];
  return key ? metas.get(key) : undefined;
}

function SlipThumb({ item }: { item: VaultMeta }) {
  const { thumb } = useVaultCover(item);
  return thumb ? (
    <ProxiedImg src={thumb} alt="" fit="cover" className="size-7 shrink-0 rounded-full" />
  ) : (
    <span className="block size-7 shrink-0 rounded-full bg-elevated" />
  );
}

/** 纸匣页的一排合集笺：封面缩略 + 名称 + 有效成员计数。空合集由调用方零占位。 */
export function CollectionsBar({
  collections,
  vaultKeys,
  metas,
  onOpen,
}: {
  collections: readonly Collection[];
  vaultKeys: ReadonlySet<string>;
  metas: ReadonlyMap<string, VaultMeta>;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {collections.map((collection) => (
        <CollectionSlip
          key={collection.id}
          collection={collection}
          vaultKeys={vaultKeys}
          metas={metas}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function CollectionSlip({
  collection,
  vaultKeys,
  metas,
  onOpen,
}: {
  collection: Collection;
  vaultKeys: ReadonlySet<string>;
  metas: ReadonlyMap<string, VaultMeta>;
  onOpen: (id: string) => void;
}) {
  const count = collectionMembers(collection, vaultKeys).length;
  const cover = coverMetaOf(collection, vaultKeys, metas);
  return (
    <button
      type="button"
      className="inline-flex max-w-56 items-center gap-2 rounded-full bg-accent/15 py-1 pl-1 pr-3 text-sm text-accent-fg transition-colors hover:bg-accent/25"
      onClick={() => onOpen(collection.id)}
    >
      {cover ? (
        <SlipThumb item={cover} />
      ) : (
        <span className="size-7 shrink-0 rounded-full bg-elevated" />
      )}
      <span className="truncate">{collection.name}</span>
      <span className="shrink-0 text-xs tabular-nums text-subtle">{count}</span>
    </button>
  );
}

/**
 * 「加入合集」弹层内容（批量工具条与单卡弹层共用）：列已有合集（名称+有效计数）
 * +「新建合集」当场命名。容器（Popover / Dialog）与关闭时机归调用方管。
 */
export function AddToCollectionPanel({
  collections,
  vaultKeys,
  onPick,
  onCreate,
}: {
  collections: readonly Collection[];
  vaultKeys: ReadonlySet<string>;
  onPick: (collectionId: string) => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  return (
    <div className="space-y-3">
      <p className="text-xs text-subtle">挑一个已有合集，或当场新建。</p>
      {collections.length > 0 ? (
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {collections.map((collection) => (
            <button
              key={collection.id}
              type="button"
              title={collection.name}
              className="h-8 max-w-full truncate rounded-full bg-elevated px-3 text-sm text-muted hover:text-fg"
              onClick={() => onPick(collection.id)}
            >
              {collection.name} · {collectionMembers(collection, vaultKeys).length}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">还没有合集，起个名字建第一个。</p>
      )}
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="新合集名字" autoFocus />
      <Button size="sm" className="w-full" disabled={!trimmed} onClick={() => onCreate(trimmed)}>
        新建合集并加入
      </Button>
    </div>
  );
}

function CoverOption({ item, active, onPick }: { item: VaultMeta; active: boolean; onPick: () => void }) {
  const { thumb } = useVaultCover(item);
  return (
    <button
      type="button"
      aria-label={`设为封面：${item.title}`}
      className={cn(
        "size-14 overflow-hidden rounded-lg border-2 transition-colors",
        active ? "border-accent" : "border-transparent hover:border-border",
      )}
      onClick={onPick}
    >
      {thumb ? (
        <ProxiedImg src={thumb} alt="" fit="cover" className="size-full" />
      ) : (
        <span className="block size-full bg-elevated" />
      )}
    </button>
  );
}

function ReorderButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className="grid size-6 place-items-center rounded-full border border-white/50 bg-black/35 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/50 hover:text-white disabled:pointer-events-none disabled:opacity-40"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/** 详情成员卡：主网格同款卡外面包一层 relative，移除钮与整理三小钮绝对定位在外层。 */
function MemberCard({
  item,
  index,
  count,
  tagAliases,
  organizing,
  onRemove,
  onReorder,
}: {
  item: VaultMeta;
  index: number;
  count: number;
  tagAliases: Record<string, string>;
  organizing: boolean;
  onRemove: () => void;
  onReorder: (action: "up" | "down" | "top") => void;
}) {
  const { thumb, width, height } = useVaultCover(item);
  const work = cardFromMeta(item, thumb, tagAliases, width, height);
  // 与 ArtworkCard 同口径算外层比例：MasonryBoard 量的是这个包裹层（data-aspect 变化会触发重排）
  const aspect = work.thumb ? cardAspect(work.width, work.height) : 3 / 4;
  return (
    <div className="relative" data-aspect={String(aspect)}>
      <ArtworkCard
        work={work}
        index={index}
        variant="vault"
        marks={item.replaced ? ["原图已被替换"] : undefined}
      />
      <button
        type="button"
        aria-label="移出合集"
        title="移出合集"
        className="absolute left-2 top-2 z-20 grid size-7 place-items-center rounded-full border border-white/50 bg-black/35 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/50 hover:text-white"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove();
        }}
      >
        <X className="size-4" />
      </button>
      {organizing ? (
        <div className="absolute right-2 top-2 z-20 flex flex-col gap-1">
          <ReorderButton label="上移" disabled={index === 0} onClick={() => onReorder("up")}>
            <ArrowUp className="size-3.5" />
          </ReorderButton>
          <ReorderButton label="下移" disabled={index === count - 1} onClick={() => onReorder("down")}>
            <ArrowDown className="size-3.5" />
          </ReorderButton>
          <ReorderButton label="置顶" disabled={index === 0} onClick={() => onReorder("top")}>
            <ArrowUpToLine className="size-3.5" />
          </ReorderButton>
        </div>
      ) : null}
    </div>
  );
}

/** 合集详情：头部一行管理按钮 + 成员网格（members 顺序 = 存储序，MVP 按钮式重排）。 */
export function CollectionDetail({
  collection,
  vaultKeys,
  metas,
  tagAliases,
  onBack,
}: {
  collection: Collection;
  vaultKeys: ReadonlySet<string>;
  metas: ReadonlyMap<string, VaultMeta>;
  tagAliases: Record<string, string>;
  onBack: () => void;
}) {
  const renameCollection = useSettings((s) => s.renameCollection);
  const setCollectionCover = useSettings((s) => s.setCollectionCover);
  const removeCollection = useSettings((s) => s.removeCollection);
  const removeFromCollection = useSettings((s) => s.removeFromCollection);
  const reorderCollectionItem = useSettings((s) => s.reorderCollectionItem);
  const [organizing, setOrganizing] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);

  // 软失效：只渲染当前纸匣里仍存在的成员，失配 key 不清洗存储（重新收藏自然恢复）
  const members = collectionMembers(collection, vaultKeys)
    .map((key) => metas.get(key))
    .filter((item): item is VaultMeta => Boolean(item));
  // 上移 / 下移 / 置顶只在这些卡片之间换位。没画出来的 key 留在原下标。
  const shownKeys = new Set(members.map((item) => item.key));

  function handleDelete() {
    if (!window.confirm(`删除合集「${collection.name}」？只删清单，里面的藏品不受影响。`)) return;
    removeCollection(collection.id);
    onBack();
    toast.success(`已删除合集「${collection.name}」，藏品不受影响`);
  }

  function handleRename() {
    const name = window.prompt("重命名合集", collection.name);
    if (name) renameCollection(collection.id, name);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}>
          ← 返回纸匣
        </Button>
        <h2 className="font-display text-xl tracking-tight text-fg">{collection.name}</h2>
        <span className="text-sm tabular-nums text-subtle">{members.length} 张</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={handleRename}>
            重命名
          </Button>
          <Popover open={coverOpen} onOpenChange={setCoverOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="ghost" disabled={members.length === 0}>
                换封面
              </Button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-72">
              <p className="mb-2 text-xs text-subtle">从成员里选封面；不选则跟随第一张。</p>
              <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
                {members.map((item) => (
                  <CoverOption
                    key={item.key}
                    item={item}
                    active={collection.coverKey === item.key}
                    onPick={() => {
                      setCollectionCover(collection.id, item.key);
                      setCoverOpen(false);
                    }}
                  />
                ))}
              </div>
              {collection.coverKey ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2 w-full"
                  onClick={() => {
                    setCollectionCover(collection.id, undefined);
                    setCoverOpen(false);
                  }}
                >
                  清除自选封面（跟随第一张）
                </Button>
              ) : null}
            </PopoverContent>
          </Popover>
          <Button
            size="sm"
            variant={organizing ? "secondary" : "ghost"}
            disabled={members.length === 0}
            onClick={() => setOrganizing((v) => !v)}
          >
            {organizing ? "完成整理" : "整理顺序"}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDelete}>
            删除合集
          </Button>
        </div>
      </div>

      {members.length === 0 ? (
        <EmptySheet
          title="合集是空的"
          hint="藏品被移出纸匣时会暂时从这里消失；重新收藏同一件作品会自动回来。"
        />
      ) : (
        <MasonryBoard>
          {members.map((item, i) => (
            <MemberCard
              key={item.key}
              item={item}
              index={i}
              count={members.length}
              tagAliases={tagAliases}
              organizing={organizing}
              onRemove={() => removeFromCollection(collection.id, item.key)}
              onReorder={(action) => reorderCollectionItem(collection.id, item.key, action, shownKeys)}
            />
          ))}
        </MasonryBoard>
      )}
    </div>
  );
}
