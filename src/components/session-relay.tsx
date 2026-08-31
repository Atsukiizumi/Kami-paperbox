import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LOGIN_VIEW, type LoginInputEvent, type LoginSite } from "@/lib/browser-login";
import { isAbortError } from "@/lib/error-component";
import { cn } from "@/lib/utils";

type RelayDone = {
  pixiv?: string;
  fanbox?: string;
  pixivProfile?: { id: string; name: string; avatar?: string } | null;
  fanboxProfile?: { id: string; name: string; avatar?: string } | null;
};

type JobView = {
  status?: string;
  error?: string;
  pageUrl?: string;
  viewWidth?: number;
  viewHeight?: number;
  frame?: string | null;
  pixiv?: string;
  fanbox?: string;
  pixivProfile?: RelayDone["pixivProfile"];
  fanboxProfile?: RelayDone["fanboxProfile"];
};

export function SessionRelayDialog({
  site,
  open,
  onOpenChange,
  onDone,
}: {
  site: LoginSite | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (data: RelayDone) => Promise<void>;
}) {
  const viewRef = useRef<HTMLDivElement>(null);
  const onDoneRef = useRef(onDone);
  const onOpenRef = useRef(onOpenChange);
  onDoneRef.current = onDone;
  onOpenRef.current = onOpenChange;
  const lastMove = useRef(0);
  const [job, setJob] = useState<JobView>({ status: "idle" });

  useEffect(() => {
    if (!open || !site) return;
    let stop = false;
    setJob({ status: "launching" });

    async function run() {
      try {
        const res = await fetch("/api/login-browser", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ site }),
        });
        const data = (await res.json()) as JobView;
        if (stop) return;
        setJob(data);
        if (data.status === "error") return;
        if (data.status === "done") {
          await onDoneRef.current(data);
          onOpenRef.current(false);
          return;
        }
      } catch (err) {
        if (stop || isAbortError(err)) return;
        setJob({ status: "error", error: err instanceof Error ? err.message : "登录失败" });
        return;
      }

      while (!stop) {
        try {
          const res = await fetch("/api/login-browser?frame=1", { cache: "no-store" });
          const data = (await res.json()) as JobView;
          if (stop) return;
          setJob(data);
          if (data.status === "done") {
            await onDoneRef.current(data);
            onOpenRef.current(false);
            return;
          }
          if (data.status === "error" || data.status === "idle") return;
        } catch (err) {
          if (stop || isAbortError(err)) return;
        }
        await new Promise((r) => setTimeout(r, 280));
      }
    }

    void run();
    return () => {
      stop = true;
    };
  }, [open, site]);

  async function send(event: LoginInputEvent) {
    if (job.status !== "waiting") return;
    try {
      await fetch("/api/login-browser", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "input", event }),
      });
    } catch {
      /* ignore dropped input */
    }
  }

  function mapPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const el = viewRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return null;
    const vw = job.viewWidth || LOGIN_VIEW.width;
    const vh = job.viewHeight || LOGIN_VIEW.height;
    return {
      x: ((clientX - r.left) / r.width) * vw,
      y: ((clientY - r.top) / r.height) * vh,
    };
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    const pt = mapPoint(e.clientX, e.clientY);
    if (!pt) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    viewRef.current?.focus();
    void send({ type: "mouse", action: "pressed", x: pt.x, y: pt.y, button: e.button });
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (e.buttons === 0) return;
    const now = Date.now();
    if (now - lastMove.current < 32) return;
    lastMove.current = now;
    const pt = mapPoint(e.clientX, e.clientY);
    if (!pt) return;
    void send({ type: "mouse", action: "moved", x: pt.x, y: pt.y, button: e.button });
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const pt = mapPoint(e.clientX, e.clientY);
    if (!pt) return;
    void send({ type: "mouse", action: "released", x: pt.x, y: pt.y, button: e.button });
  }

  function onWheel(e: WheelEvent<HTMLDivElement>) {
    const pt = mapPoint(e.clientX, e.clientY);
    if (!pt) return;
    e.preventDefault();
    void send({ type: "mouse", action: "wheel", x: pt.x, y: pt.y, deltaX: e.deltaX, deltaY: e.deltaY });
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.nativeEvent.isComposing || e.key === "Process") return;
    if (e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    if (e.key.length === 1) void send({ type: "text", text: e.key });
    else void send({ type: "key", action: "down", key: e.key });
  }

  function onKeyUp(e: KeyboardEvent<HTMLDivElement>) {
    if (e.nativeEvent.isComposing || e.key === "Process") return;
    if (e.ctrlKey || e.metaKey) return;
    if (e.key.length === 1) return;
    e.preventDefault();
    void send({ type: "key", action: "up", key: e.key });
  }

  async function close() {
    if (job.status === "done") {
      onOpenChange(false);
      return;
    }
    try {
      await fetch("/api/login-browser", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
    } catch {
      /* ignore */
    }
    onOpenChange(false);
  }

  const frame = job.frame && job.frame !== "*" ? job.frame : null;
  const siteLabel = site === "fanbox" ? "FANBOX" : "Pixiv";

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : void close())}>
      <DialogContent className="w-[min(96vw,56rem)] p-4">
        <DialogTitle>在官方页面登录 {siteLabel}</DialogTitle>
        <DialogDescription>
          这是后端开的官方登录页，密码只打在 {siteLabel} 自己的页面上。登进去之后纸匣会把会话收回来。
        </DialogDescription>
        <div
          ref={viewRef}
          tabIndex={0}
          role="application"
          aria-label={`${siteLabel} 官方登录页`}
          className={cn(
            "relative mt-3 overflow-hidden rounded-lg bg-elevated outline-none ring-offset-bg focus-visible:ring-2 focus-visible:ring-accent/50",
            "touch-none select-none",
          )}
          style={{ aspectRatio: `${LOGIN_VIEW.width} / ${LOGIN_VIEW.height}` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (text) {
              e.preventDefault();
              void send({ type: "text", text });
            }
          }}
          onCompositionEnd={(e) => {
            if (e.data) void send({ type: "text", text: e.data });
          }}
        >
          {frame ? (
            <img
              src={`data:image/jpeg;base64,${frame}`}
              alt=""
              draggable={false}
              className="pointer-events-none h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full min-h-64 items-center justify-center px-6 text-center text-sm text-muted">
              {job.status === "error" ? job.error || "登录失败" : "正在打开官方登录页…点一下画面后即可输入。"}
            </div>
          )}
        </div>
        <p className="mt-2 truncate text-xs text-subtle">
          {job.status === "error"
            ? job.error
            : job.status === "waiting" || job.status === "launching"
              ? job.pageUrl || "正在连接官方站点"
              : "已结束"}
        </p>
        <div className="mt-3 flex justify-end">
          <Button variant="secondary" onClick={() => void close()}>
            <X className="size-4" />
            取消
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
