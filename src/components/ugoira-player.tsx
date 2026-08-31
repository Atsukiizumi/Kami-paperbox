import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { UgoiraFrame } from "@/lib/ugoira-meta";
import { unzipUgoira } from "@/lib/ugoira-zip";
import { cn, mediaUrl } from "@/lib/utils";
import { Skeleton } from "./ui/skeleton";

export function UgoiraPlayer({
  zipUrl,
  frames,
  alt,
  className,
  onOpen,
}: {
  zipUrl: string;
  frames: UgoiraFrame[];
  alt: string;
  className?: string;
  onOpen?: () => void;
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

  const frameKey = frames.map((f) => `${f.file}:${f.delay}`).join("|");

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    async function load() {
      try {
        const res = await fetch(mediaUrl(zipUrl));
        if (!res.ok) throw new Error("动图下载失败");
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
    if (!ready || !playing || bitmaps.current.length < 2) return;
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
  }, [ready, playing]);

  return (
    <div className={cn("relative overflow-hidden bg-elevated", className)}>
      {!ready && !error ? <Skeleton className="absolute inset-0" /> : null}
      {error ? (
        <p className="flex min-h-48 items-center justify-center px-4 text-sm text-muted">{error}</p>
      ) : null}
      <canvas
        ref={canvasRef}
        aria-label={alt}
        className={cn(
          "mx-auto max-h-[85vh] w-full object-contain transition-opacity duration-200",
          ready ? "opacity-100" : "opacity-0",
          onOpen && "cursor-zoom-in",
        )}
        onClick={onOpen}
      />
      {ready ? (
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
