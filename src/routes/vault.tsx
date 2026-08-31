/**
 * 纸匣页：浏览已保存作品。
 *
 * 作用：从本机目录（IndexedDB）列出作品，可搜索、按站点/作者过滤、预览、导出、删除。
 * 用法：路由 `/vault`。点卡片放大；「导出」按设置写入文件夹或下载。
 * 为什么：磁盘文件夹按作者/日期铺开之后没法搜，所以查询走目录里的元数据
 *        （标题、作者、标签、相对路径）。本机 Node 跑着时优先读 `.data/vault` 的 SQLite；
 *        否则回退浏览器 IndexedDB。
 */
import { createFileRoute } from "@tanstack/react-router";
import { Download, ExternalLink, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ImageLightbox, type LightboxItem } from "@/components/image-lightbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SITE_LIST, workOriginUrl } from "@/lib/sites";
import { extFromNameOrType } from "@/lib/ugoira-meta";
import { formatBytes, cn } from "@/lib/utils";
import { exportVaultItem } from "@/lib/persist-files";
import { useSettings } from "@/lib/store";
import {
  deleteVaultWork,
  getVaultBlob,
  listVault,
  type VaultMeta,
} from "@/lib/vault";
import { filterVaultItems, vaultAuthors, vaultTotals } from "@/lib/vault-query";
import { listServerVault } from "@/lib/vault-sync";
import type { Source } from "@/lib/types";

export const Route = createFileRoute("/vault")({ component: VaultPage });

function VaultPage() {
  const folderLabel = useSettings((s) => s.folderLabel);
  const vaultMirrorFolder = useSettings((s) => s.vaultMirrorFolder);
  const [all, setAll] = useState<VaultMeta[]>([]);
  const [origin, setOrigin] = useState<"server" | "browser">("browser");
  const [text, setText] = useState("");
  const [source, setSource] = useState<Source | "all">("all");
  const [author, setAuthor] = useState("");
  const [open, setOpen] = useState<VaultMeta | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [pages, setPages] = useState<LightboxItem[]>([]);

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

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    async function load() {
      if (!open) {
        setPages([]);
        return;
      }
      const next: LightboxItem[] = [];
      for (let i = 0; i < open.pageCount; i += 1) {
        const blob = await getVaultBlob(open.key, i);
        if (cancelled) return;
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        urls.push(url);
        next.push({ src: url, alt: `${open.title} ${i + 1}` });
      }
      if (!cancelled) setPages(next);
    }
    void load();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [open]);

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

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-3xl tracking-tight md:text-4xl">纸匣</h1>
        <p className="mt-1 text-sm text-muted">
          {origin === "server"
            ? "目录在本机 Node（`.data/vault` 的 SQLite），原图写在旁边的 files。清浏览器也不会丢。"
            : folderLabel && vaultMirrorFolder
              ? `预览在浏览器目录里，文件同时写入「${folderLabel}」。可用下面的搜索按标题、作者、标签或路径查找。`
              : "保存在这台设备的浏览器目录里。启动本机 Node 后会同时写入 `.data/vault`。"}
        </p>
      </header>

      {all.length > 0 ? (
        <div className="space-y-3">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => e.preventDefault()}
          >
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="搜索标题、作者、标签、作品 ID 或文件夹路径"
              className="flex-1"
            />
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSource("all")}
              className={cn(
                "h-9 rounded-full px-3.5 text-sm",
                source === "all" ? "bg-accent text-accent-fg" : "bg-elevated text-muted hover:text-fg",
              )}
            >
              全部
            </button>
            {SITE_LIST.map((site) => (
              <button
                key={site.id}
                type="button"
                onClick={() => setSource(site.id)}
                className={cn(
                  "h-9 rounded-full px-3.5 text-sm",
                  source === site.id ? "bg-accent text-accent-fg" : "bg-elevated text-muted hover:text-fg",
                )}
              >
                {site.label}
              </button>
            ))}
            {authors.length > 1 ? (
              <select
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                className="h-9 rounded-full bg-elevated px-3 text-sm text-fg"
                aria-label="按作者筛选"
              >
                <option value="">全部作者</option>
                {authors.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            ) : null}
            <span className="ml-auto text-xs tabular-nums text-subtle">
              {totals.count} 条 · {formatBytes(totals.bytes)}
            </span>
          </div>
        </div>
      ) : null}

      {all.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">
          还是空的。打开任意作品，点「收入纸匣」。动图会存成 GIF。
        </p>
      ) : items.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">没有符合条件的记录。</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item, i) => (
            <article
              key={item.key}
              className="kami-enter overflow-hidden rounded-xl bg-surface transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-1 hover:shadow-[var(--shadow-float)]"
              style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
            >
              <button
                type="button"
                className="block w-full cursor-zoom-in text-left"
                onClick={() => {
                  setPreviewIndex(0);
                  setOpen(item);
                }}
              >
                <VaultThumb item={item} />
                <div className="space-y-0.5 px-3 py-3">
                  <h2 className="line-clamp-2 text-sm font-medium leading-snug">{item.title}</h2>
                  <p className="line-clamp-1 text-xs text-muted">
                    {item.author} · {formatBytes(item.bytes)}
                  </p>
                  {item.relativePath ? (
                    <p className="line-clamp-1 text-xs text-subtle" title={item.relativePath}>
                      {item.relativePath}
                    </p>
                  ) : null}
                </div>
              </button>
              <div className="flex gap-1 px-2 pb-2">
                <Button variant="ghost" size="sm" asChild>
                  <a
                    href={workOriginUrl(item.source, item.id, item.authorId)}
                    target="_blank"
                    rel="noreferrer"
                    title="原始链接"
                  >
                    <ExternalLink className="size-4" />
                    原始链接
                  </a>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void exportWork(item)}>
                  <Download className="size-4" />
                  导出
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:text-danger"
                  onClick={async () => {
                    await deleteVaultWork(item.key);
                    if (open?.key === item.key) setOpen(null);
                    await refresh();
                    toast.success("已从纸匣移除");
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <ImageLightbox
        items={pages}
        index={previewIndex}
        open={Boolean(open) && pages.length > 0}
        onClose={() => setOpen(null)}
        onIndex={setPreviewIndex}
        originUrl={open ? workOriginUrl(open.source, open.id, open.authorId) : undefined}
      />
    </div>
  );
}

function VaultThumb({ item }: { item: VaultMeta }) {
  const [src, setSrc] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let url = "";
    setLoaded(false);
    setSrc("");
    void getVaultBlob(item.key, 0).then((blob) => {
      if (!blob) return;
      const next = URL.createObjectURL(blob);
      if (cancelled) {
        URL.revokeObjectURL(next);
        return;
      }
      url = next;
      setSrc(next);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.key]);
  return (
    <div className="aspect-[3/4] bg-elevated">
      {src ? (
        <img
          src={src}
          alt=""
          className={cn(
            "size-full object-cover transition-opacity duration-500 ease-out",
            loaded ? "opacity-100" : "opacity-0",
          )}
          onLoad={() => setLoaded(true)}
        />
      ) : null}
    </div>
  );
}
