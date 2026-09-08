/**
 * 纸匣页：用浏览同一套拼版看已保存作品。
 *
 * 作用：按行补缝，封面保持原比例。交互仍是点进作品、悬停导出/移除。
 * 用法：侧栏入口。优先读用户文件夹原图。
 */
"use client";

import { Link } from "@/lib/kami-link";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { toast } from "sonner";
import { ArtworkCard } from "@/components/artwork-card";
import { EmptySheet } from "@/components/empty-sheet";
import { MasonryBoard } from "@/components/masonry-board";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SITE_LIST } from "@/lib/sites";
import { extFromNameOrType } from "@/lib/ugoira-meta";
import { formatBytes, cn } from "@/lib/utils";
import { exportVaultItem, previewFromFolder } from "@/lib/persist-files";
import { useSettings } from "@/lib/store";
import { deleteVaultWork, getVaultBlob, listVault, type VaultMeta } from "@/lib/vault";
import { forgetVaultKey } from "@/lib/vault-index";
import { filterVaultItems, vaultAuthors, vaultTotals } from "@/lib/vault-query";
import { listServerVault, vaultPageUrl } from "@/lib/vault-sync";
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
  const folderLabel = useSettings((s) => s.folderLabel);
  const [all, setAll] = useState<VaultMeta[]>([]);
  const [text, setText] = useState("");
  const [source, setSource] = useState<Source | "all">("all");
  const [author, setAuthor] = useState("");
  const [ready, setReady] = useState(false);

  async function refresh() {
    let local: VaultMeta[] = [];
    try {
      local = await listVault();
    } catch {
      local = [];
    }
    const remote = await listServerVault();
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
    void refresh();
  }, []);

  const items = useMemo(
    () => filterVaultItems(all, { text, source, author }),
    [all, text, source, author],
  );
  const authors = useMemo(() => {
    const pool = source === "all" ? all : all.filter((item) => item.source === source);
    return vaultAuthors(pool).filter((name) => name.trim() !== "");
  }, [all, source]);
  const totals = vaultTotals(items);
  const folderOnly = all.filter((item) => item.relativePath && item.hasFile === false).length;

  useEffect(() => {
    if (author && !authors.includes(author)) setAuthor("");
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

  async function removeWork(item: VaultMeta) {
    await deleteVaultWork(item.key);
    forgetVaultKey(item.key);
    await refresh();
    toast.success("已从目录移除");
  }

  return (
    <div className="space-y-5">
      <header>
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
                  {authors.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <span className="ml-auto text-xs tabular-nums text-subtle">
              {totals.count} 条 · {formatBytes(totals.bytes)}
            </span>
          </div>
        </div>
      ) : null}

      {!ready ? (
        <p className="text-sm text-muted">正在读取纸匣…</p>
      ) : all.length === 0 ? (
        <EmptySheet
          title="还是空的"
          hint="去浏览把喜欢的图收进来。"
          action={
            <Button asChild>
              <Link to="/">去浏览</Link>
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptySheet title="没有符合条件的记录。" hint="换个站点或作者再看。" />
      ) : (
        <MasonryBoard>
          {items.map((item, i) => (
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
        </MasonryBoard>
      )}
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
  const serverThumb = item.hasFile ? vaultPageUrl(item.key) : "";
  const [thumb, setThumb] = useState(serverThumb);
  const [size, setSize] = useState<{ width?: number; height?: number }>({});

  useEffect(() => {
    let cancelled = false;
    let url = "";
    void (async () => {
      const folderBlob = await previewFromFolder(item);
      const blob =
        folderBlob ||
        (await getVaultBlob(item.key, 0, { localOnly: item.hasFile === false }));
      if (cancelled) return;
      if (blob) {
        url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          if (!cancelled) setSize({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.src = url;
        setThumb(url);
        return;
      }
      setThumb(item.hasFile ? vaultPageUrl(item.key) : "");
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.key, item.relativePath, item.hasFile]);

  return (
    <ArtworkCard
      work={cardFromMeta(item, thumb, size.width, size.height)}
      index={index}
      variant="vault"
      marks={item.replaced ? ["原图已被替换"] : undefined}
      onExport={onExport}
      onDelete={onDelete}
    />
  );
}
