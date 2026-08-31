import { createFileRoute } from "@tanstack/react-router";
import { Download, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ImageLightbox, type LightboxItem } from "@/components/image-lightbox";
import { Button } from "@/components/ui/button";
import { extFromNameOrType } from "@/lib/ugoira-meta";
import { formatBytes } from "@/lib/utils";
import {
  deleteVaultWork,
  downloadBlob,
  getVaultBlob,
  listVault,
  type VaultMeta,
} from "@/lib/vault";

export const Route = createFileRoute("/vault")({ component: VaultPage });

function VaultPage() {
  const [items, setItems] = useState<VaultMeta[]>([]);
  const [open, setOpen] = useState<VaultMeta | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [pages, setPages] = useState<LightboxItem[]>([]);

  async function refresh() {
    setItems(await listVault());
  }

  useEffect(() => {
    void refresh();
  }, []);

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
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
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
    for (let i = 0; i < item.pageCount; i += 1) {
      const blob = await getVaultBlob(item.key, i);
      if (!blob) continue;
      const ext = extFromNameOrType(undefined, blob.type);
      downloadBlob(blob, `${item.id}_p${i}.${ext}`);
    }
    toast.success("已导出");
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-3xl tracking-tight md:text-4xl">纸匣</h1>
        <p className="mt-1 text-sm text-muted">保存在这台设备上，不会同步到云端。点开可放大预览。</p>
      </header>
      {items.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">
          还是空的。打开任意作品，点「收入纸匣」。动图会存成 GIF。
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item, i) => (
            <article
              key={item.key}
              className="kami-enter overflow-hidden rounded-xl bg-surface transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-[var(--shadow-float)]"
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
                  <h2 className="line-clamp-1 text-sm font-medium">{item.title}</h2>
                  <p className="text-xs text-muted">
                    {item.author} · {formatBytes(item.bytes)}
                  </p>
                </div>
              </button>
              <div className="flex gap-1 px-2 pb-2">
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
      />
    </div>
  );
}

function VaultThumb({ item }: { item: VaultMeta }) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    let url = "";
    void getVaultBlob(item.key, 0).then((blob) => {
      if (!blob) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.key]);
  return (
    <div className="aspect-[3/4] bg-elevated">
      {src ? <img src={src} alt="" className="size-full object-cover" /> : null}
    </div>
  );
}
