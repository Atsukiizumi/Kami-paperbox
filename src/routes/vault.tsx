/**
 * 纸匣页：浏览已保存作品。
 *
 * 作用：从本机目录列出作品，搜索、按站点/作者筛选，点进作品页。
 * 用法：路由 `/vault`。导出 / 删除在卡片悬停条上。
 * 为什么：磁盘文件夹没法搜；拼版跟浏览页同一套，纸匣才像纸匣。
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { toast } from "sonner";
import { ArtworkCard } from "@/components/artwork-card";
import { MasonryBoard } from "@/components/masonry-board";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SITE_LIST } from "@/lib/sites";
import { extFromNameOrType } from "@/lib/ugoira-meta";
import { formatBytes, cn } from "@/lib/utils";
import { exportVaultItem } from "@/lib/persist-files";
import { useSettings } from "@/lib/store";
import { deleteVaultWork, getVaultBlob, listVault, type VaultMeta } from "@/lib/vault";
import { forgetVaultKey } from "@/lib/vault-index";
import { filterVaultItems, vaultAuthors, vaultTotals } from "@/lib/vault-query";
import { listServerVault, vaultPageUrl } from "@/lib/vault-sync";
import type { Source, WorkCard } from "@/lib/types";

export const Route = createFileRoute("/vault")({ component: VaultPage });

function cardFromMeta(item: VaultMeta, thumb: string): WorkCard {
  return {
    source: item.source,
    id: item.id,
    title: item.title,
    author: item.author,
    authorId: item.authorId,
    thumb,
    pageCount: item.pageCount,
    tags: item.tags,
  };
}

function VaultPage() {
  const folderLabel = useSettings((s) => s.folderLabel);
  const vaultMirrorFolder = useSettings((s) => s.vaultMirrorFolder);
  const [all, setAll] = useState<VaultMeta[]>([]);
  const [origin, setOrigin] = useState<"server" | "browser">("browser");
  const [text, setText] = useState("");
  const [source, setSource] = useState<Source | "all">("all");
  const [author, setAuthor] = useState("");

  async function refresh() {
    const remote = await listServerVault();
    if (remote) {
      setOrigin("server");
      setAll(remote.items);
      return;
    }
    setOrigin("browser");
    setAll(await listVault());
  }

  useEffect(() => {
    void refresh();
  }, []);

  const items = useMemo(
    () => filterVaultItems(all, { text, source, author }),
    [all, text, source, author],
  );
  const authors = useMemo(() => vaultAuthors(all), [all]);
  const totals = vaultTotals(items);

  async function exportWork(item: VaultMeta) {
    const files: { blob: Blob; ext: string }[] = [];
    for (let i = 0; i < item.pageCount; i += 1) {
      const blob = await getVaultBlob(item.key, i);
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
    toast.success("已从纸匣移除");
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-3xl tracking-tight md:text-4xl">纸匣</h1>
        <p className="mt-1 text-sm text-muted">
          {origin === "server"
            ? "目录在本机 Node（`.data/vault`），点卡片打开作品页。"
            : folderLabel && vaultMirrorFolder
              ? `预览在浏览器里，文件同时写入「${folderLabel}」。`
              : "保存在这台设备的浏览器目录里。"}
        </p>
      </header>

      {all.length > 0 ? (
        <div className="space-y-3">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="搜索标题、作者、标签、作品 ID 或文件夹路径"
          />
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip active={source === "all"} onClick={() => setSource("all")}>
              全部
            </FilterChip>
            {SITE_LIST.map((site) => (
              <FilterChip
                key={site.id}
                active={source === site.id}
                onClick={() => setSource(site.id)}
              >
                {site.label}
              </FilterChip>
            ))}
            <span className="ml-auto text-xs tabular-nums text-subtle">
              {totals.count} 条 · {formatBytes(totals.bytes)}
            </span>
          </div>
          {authors.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              <FilterChip active={!author} onClick={() => setAuthor("")}>
                全部作者
              </FilterChip>
              {authors.map((name) => (
                <FilterChip key={name} active={author === name} onClick={() => setAuthor(name)}>
                  {name}
                </FilterChip>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {all.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-muted">还是空的。去浏览里把喜欢的图收进来。</p>
          <Button asChild>
            <Link to="/">去浏览</Link>
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">没有符合条件的记录。</p>
      ) : (
        <MasonryBoard>
          {items.map((item, i) => (
            <VaultCard
              key={item.key}
              item={item}
              index={i}
              origin={origin}
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
  origin,
  onExport,
  onDelete,
}: {
  item: VaultMeta;
  index: number;
  origin: "server" | "browser";
  onExport: (e: MouseEvent) => void;
  onDelete: (e: MouseEvent) => void;
}) {
  const [thumb, setThumb] = useState(origin === "server" ? vaultPageUrl(item.key) : "");

  useEffect(() => {
    if (origin === "server") {
      setThumb(vaultPageUrl(item.key));
      return;
    }
    let cancelled = false;
    let url = "";
    void getVaultBlob(item.key, 0).then((blob) => {
      if (!blob) return;
      const next = URL.createObjectURL(blob);
      if (cancelled) {
        URL.revokeObjectURL(next);
        return;
      }
      url = next;
      setThumb(next);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.key, origin]);

  return (
    <ArtworkCard
      work={cardFromMeta(item, thumb)}
      index={index}
      variant="vault"
      onExport={onExport}
      onDelete={onDelete}
    />
  );
}
