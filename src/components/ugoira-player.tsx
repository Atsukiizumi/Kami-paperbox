/**
 * Pixiv 动图播放。
 *
 * 作用：把 ugoira zip 解成帧，在 canvas 上按延时循环。
 * 用法：详情页 <UgoiraPlayer zipUrl frames />；卡片 compact + active。
 * 为什么：浏览器不能直接播 zip。卡片只在进视口后拉 zip，滚走就停。
 */
import { useQuery } from "@tanstack/react-query";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fetchSource } from "@/lib/source";
import { cookiesFromSettings } from "@/lib/store";
import type { UgoiraFrame, UgoiraMeta } from "@/lib/ugoira-meta";
import { unzipUgoira } from "@/lib/ugoira-zip";
import { cn, mediaUrl } from "@/lib/utils";
import { ProxiedImg } from "./proxied-img";
import { Skeleton } from "./ui/skeleton";

export function useUgoiraMeta(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["ugoira", id],
    enabled: Boolean(id) && enabled,
    staleTime: 60 * 60_000,
    queryFn: async (): Promise<UgoiraMeta> => {
      const r = await fetchSource({ data: { op: "pixivUgoira", id: id!, ...cookiesFromSettings() } });
      if (r.op !== "pixivUgoira") throw new Error("不是动图");
      return r.ugoira;
    },
  });
}

/** 拉 ugoira zip。代理高并发会偶发 429/204，最后一发用 cache:"reload" 绕开可能损坏的缓存条目。 */
async function fetchZip(url: string): Promise<Response> {
  let lastError = new Error("动图下载失败");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, attempt === 2 ? { cache: "reload" } : undefined);
      if (res.ok) return res;
      lastError = new Error(`动图下载失败（${res.status}）`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("动图下载失败");
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
  }
  throw lastError;
}

export function UgoiraPlayer({
  zipUrl,
  frames,
  alt,
  className,
  onOpen,
  compact = false,
  active = true,
}: {
  zipUrl: string;
  frames: UgoiraFrame[];
  alt: string;
  className?: string;
  onOpen?: () => void;
  compact?: boolean;
  active?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bitmaps = useRef<ImageBitmap[]>([]);
  const delays = useRef<number[]>([]);
  const frameRef = useRef(0);
  const timer = useRef(0);
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const run = playing && active;

  const frameKey = frames.map((f) => `${f.file}:${f.delay}`).join("|");

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    async function load() {
      try {
        const res = await fetchZip(mediaUrl(zipUrl));
        const zipBytes = new Uint8Array(await res.arrayBuffer());
        const unpacked = await unzipUgoira(zipBytes, framesRef.current);
        const decoded: ImageBitmap[] = [];
        for (const frame of unpacked) {
          const copy = new Uint8Array(frame.bytes.byteLength);
          copy.set(frame.bytes);
          decoded.push(await createImageBitmap(new Blob([copy])));
        }
        if (cancelled) {
          decoded.forEach((b) => b.close());
          return;
        }
        bitmaps.current.forEach((b) => b.close());
        bitmaps.current = decoded;
        delays.current = unpacked.map((f) => f.delay);
        const canvas = canvasRef.current;
        const first = decoded[0];
        if (canvas && first) {
          canvas.width = first.width;
          canvas.height = first.height;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(first, 0, 0);
        }
        setReady(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "动图无法播放");
      }
    }
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer.current);
      bitmaps.current.forEach((b) => b.close());
      bitmaps.current = [];
    };
  }, [zipUrl, frameKey]);

  useEffect(() => {
    if (!ready || !run || bitmaps.current.length < 2) return;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const list = bitmaps.current;
      if (list.length === 0) return;
      frameRef.current = (frameRef.current + 1) % list.length;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const bmp = list[frameRef.current];
      if (canvas && ctx && bmp) {
        if (canvas.width !== bmp.width) canvas.width = bmp.width;
        if (canvas.height !== bmp.height) canvas.height = bmp.height;
        ctx.drawImage(bmp, 0, 0);
      }
      timer.current = window.setTimeout(tick, delays.current[frameRef.current] || 80);
    };
    timer.current = window.setTimeout(tick, delays.current[0] || 80);
    return () => {
      alive = false;
      window.clearTimeout(timer.current);
    };
  }, [ready, run]);

  return (
    <div className={cn("relative overflow-hidden bg-elevated", className)}>
      {!compact && !ready && !error ? <Skeleton className="absolute inset-0" /> : null}
      {error ? (
        <p className="flex min-h-48 items-center justify-center px-4 text-sm text-muted">{error}</p>
      ) : null}
      <canvas
        ref={canvasRef}
        aria-label={alt}
        className={cn(
          compact
            ? "absolute inset-0 size-full object-cover"
            : "mx-auto max-h-[85vh] w-full object-contain",
          "transition-opacity duration-200",
          ready ? "opacity-100" : "opacity-0",
          onOpen && "cursor-zoom-in",
        )}
        onClick={onOpen}
      />
      {ready && !compact ? (
        <button
          type="button"
          aria-label={playing ? "暂停" : "播放"}
          className="absolute bottom-3 right-3 flex size-11 items-center justify-center rounded-full bg-bg/80 text-fg transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.96]"
          onClick={(e) => {
            e.stopPropagation();
            setPlaying((v) => !v);
          }}
        >
          <span className="relative size-5">
            <Play
              className={cn(
                "absolute inset-0 size-5 transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
                playing ? "scale-[0.25] opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-none",
              )}
            />
            <Pause
              className={cn(
                "absolute inset-0 size-5 transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
                playing ? "scale-100 opacity-100 blur-none" : "scale-[0.25] opacity-0 blur-[4px]",
              )}
            />
          </span>
        </button>
      ) : null}
    </div>
  );
}

export function UgoiraCover({
  id,
  poster,
  alt,
  priority,
  hidden,
  className,
}: {
  id: string;
  poster: string;
  alt: string;
  priority?: boolean;
  hidden?: boolean;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(Boolean(entry?.isIntersecting)), {
      threshold: 0.15,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const meta = useUgoiraMeta(id, onScreen || Boolean(hidden));
  return (
    <div ref={hostRef} className={cn("relative size-full", className)}>
      <ProxiedImg src={poster} alt={alt} priority={priority} className="size-full" />
      {meta.data && onScreen ? (
        <UgoiraPlayer
          zipUrl={meta.data.src}
          frames={meta.data.frames}
          alt={alt}
          compact
          active={!hidden}
          className={cn("absolute inset-0", hidden && "opacity-0")}
        />
      ) : null}
    </div>
  );
}
