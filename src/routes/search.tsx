import { createFileRoute, Link } from "@tanstack/react-router";
import { ExternalLink, ImagePlus, LoaderCircle, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ProxiedImg } from "@/components/proxied-img";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SEARCH_FILE_EVENT } from "@/components/drop-to-search";
import { prepareSearchImage } from "@/lib/prepare-search-image";
import {
  engineLabel,
  MAX_SEARCH_BYTES,
  SEARCH_ENGINES,
  SEARCH_TYPES,
  takeReverseImage,
  type ReverseHit,
  type SearchGroup,
} from "@/lib/reverse-search";
import { useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/search")({ component: SearchPage });

type ApiOk = { ok: true; groups: SearchGroup[] };
type ApiErr = { ok: false; error: string };

function SearchPage() {
  const safeMode = useSettings((s) => s.safeMode);
  const apiKey = useSettings((s) => s.saucenaoApiKey);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const applyFile = useCallback((next: File | null) => {
    if (!next) return;
    if (next.size > MAX_SEARCH_BYTES) {
      toast.error("图片超过 8 MB，请缩小后再试");
      return;
    }
    if (next.type && !SEARCH_TYPES.has(next.type) && !next.type.startsWith("image/")) {
      toast.error("只支持 JPEG / PNG / GIF / WebP");
      return;
    }
    setFile(next);
    setGroups([]);
    setError("");
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(next);
    });
  }, []);

  async function run(target: File) {
    setLoading(true);
    setError("");
    try {
      const prepared = await prepareSearchImage(target);
      const body = new FormData();
      body.set("file", prepared);
      body.set("safe", safeMode ? "1" : "0");
      if (apiKey) body.set("apiKey", apiKey);
      const res = await fetch("/api/reverse-search", { method: "POST", body });
      const data = (await res.json()) as ApiOk | ApiErr;
      if (!data.ok) throw new Error(data.error || "搜图失败");
      setGroups(data.groups);
    } catch (err) {
      const message = err instanceof Error ? err.message : "搜图失败";
      setGroups([]);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const stashed = takeReverseImage();
    if (!stashed) return;
    const next = new File([stashed.bytes], stashed.name, { type: stashed.type || "image/jpeg" });
    applyFile(next);
    void run(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot from work page once
  }, []);

  useEffect(() => {
    function onPaste(ev: ClipboardEvent) {
      const item = [...(ev.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!item) return;
      ev.preventDefault();
      applyFile(item);
    }
    function onDropped(ev: Event) {
      const dropped = (ev as CustomEvent<File>).detail;
      if (dropped instanceof File) applyFile(dropped);
    }
    window.addEventListener("paste", onPaste);
    window.addEventListener(SEARCH_FILE_EVENT, onDropped);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener(SEARCH_FILE_EVENT, onDropped);
    };
  }, [applyFile]);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="font-display text-3xl tracking-tight md:text-4xl">搜图</h1>
        {!apiKey ? (
          <p className="text-xs text-subtle">
            SauceNAO 建议在{" "}
            <Link to="/settings" hash="search" className="text-muted hover:text-fg hover:underline">
              设置
            </Link>{" "}
            填 API key，匿名很容易被风控。
          </p>
        ) : null}
      </header>

      <Card
        className={cn("transition-colors duration-200", dragOver ? "bg-elevated" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const dropped = e.dataTransfer.files[0];
          if (dropped) applyFile(dropped);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,image/bmp"
          className="hidden"
          onChange={(e) => {
            const next = e.target.files?.[0];
            if (next) applyFile(next);
            e.target.value = "";
          }}
        />
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex aspect-square w-36 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-elevated"
          >
            {preview ? (
              <img src={preview} alt="待搜" className="size-full object-cover" />
            ) : (
              <ImagePlus className="size-8 text-muted" />
            )}
          </button>
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-sm text-muted">拖到这里，或点选文件。也可以 Ctrl+V 粘贴。</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
                <Upload className="size-4" />
                选择图片
              </Button>
              <Button type="button" disabled={!file || loading} onClick={() => file && void run(file)}>
                {loading ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {loading ? "正在搜…" : "开始搜图"}
              </Button>
            </div>
            {file ? (
              <p className="truncate text-xs text-subtle">
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      {error ? <p className="text-sm text-muted">{error}</p> : null}

      {loading && groups.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">
          正在问 {SEARCH_ENGINES.map((e) => e.label).join(" / ")}…
        </p>
      ) : null}

      {groups.map((group) => (
        <section key={group.engine} className="space-y-3">
          <h2 className="text-lg font-semibold">{engineLabel(group.engine)}</h2>
          {group.status === "limited" ? (
            <p className="text-sm text-muted">{group.error || `${engineLabel(group.engine)} 被风控了`}</p>
          ) : group.status === "error" ? (
            <p className="text-sm text-muted">{group.error || "这组没有结果"}</p>
          ) : group.status === "empty" ? (
            <p className="text-sm text-muted">没有相近的图。</p>
          ) : (
            <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((hit, i) => (
                <HitCard key={`${hit.sourceUrl}-${i}`} hit={hit} index={i} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function HitCard({ hit, index = 0 }: { hit: ReverseHit; index?: number }) {
  const inner = (
    <>
      <div className="relative aspect-[4/3] overflow-hidden bg-elevated">
        {hit.thumb ? (
          <ProxiedImg src={hit.thumb} alt={hit.title} className="size-full object-cover" />
        ) : (
          <div className="size-full" />
        )}
        {hit.similarity > 0 ? (
          <Badge className="absolute left-2 top-2 bg-bg/80 text-fg">
            {hit.similarity.toFixed(hit.similarity >= 10 ? 0 : 1)}%
          </Badge>
        ) : hit.extra ? (
          <Badge className="absolute left-2 top-2 bg-bg/80 text-fg">{hit.extra}</Badge>
        ) : null}
      </div>
      <div className="space-y-1 px-3 py-2">
        <h3 className="line-clamp-2 text-sm font-medium text-fg">{hit.title || "未命名"}</h3>
        <p className="line-clamp-1 text-xs text-muted">{hit.author || hit.extra || engineLabel(hit.engine)}</p>
      </div>
    </>
  );

  return (
    <li className="kami-enter" style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}>
      <div className="kami-card-shell">
        {hit.site && hit.workId ? (
          <Link to="/work/$source/$id" params={{ source: hit.site, id: hit.workId }} className="block">
            {inner}
          </Link>
        ) : hit.sourceUrl ? (
          <a href={hit.sourceUrl} target="_blank" rel="noreferrer" className="block">
            {inner}
          </a>
        ) : (
          <div>{inner}</div>
        )}
        {hit.sourceUrl ? (
          <div className="flex items-center justify-between gap-2 px-3 pb-2">
            <span className="truncate text-xs text-subtle">{hostOf(hit.sourceUrl)}</span>
            <a
              href={hit.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-elevated hover:text-fg"
              aria-label="原页"
            >
              <ExternalLink className="size-3.5" />
            </a>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
