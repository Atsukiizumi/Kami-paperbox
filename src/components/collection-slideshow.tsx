"use client";

/**
 * 合集幻灯片（C1，10-17-slideshow-stale-clean）。
 *
 * 作用：合集详情「放映」的全屏自动播放——一成员一屏（第 0 页原图），懒解析像素
 *      （当前张 + 预热后两张，Map 缓存，卸载统一 revoke），循环翻页，速度 3/5/10s
 *      默认 5s，Esc 关 / ←→ 翻页 / 空格播停；遮盖开着时 R-18/AI 走「中间点击先
 *      揭示本张」（与作品详情页的逐张临时揭示同语义）。无像素成员前置过滤
 *      （hasVaultCover），过滤数常驻提示；运行期单张解析失败只标当前张，放映继续。
 * 用法：<CollectionSlideshow name members open onClose /> 挂 CollectionDetail 尾部
 *      条件渲染（关闭即卸载，URL 全收）；resolveSlide 可注入（组件测试塞假 Blob），
 *      缺省走 previewFromFolder → getVaultBlob——与 useVaultCover / 导出同一链。
 * 为什么并列新组件不复用 ImageLightbox：灯箱的 LightboxItem.src 是同步字符串，
 *      幻灯片像素按需异步解析，硬套会出现「src 没解出来就要渲染」的空串竞态
 *      （design §1.1）；这里只借它的形态——portal 遮罩、键盘、页码。
 */
import { Loader2, Pause, Play, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { previewFromFolder } from "@/lib/storage/persist-files";
import { getVaultBlob, type VaultMeta } from "@/lib/storage/vault";
import { hasVaultCover } from "@/lib/storage/vault-profile";
import { shouldVeil, useVeil } from "@/lib/veil";
import { cn } from "@/lib/utils";

/** 放映速度三档（ms），默认 5000——定案值。 */
const SPEEDS = [3000, 5000, 10000] as const;

/**
 * 幻灯片幕列表：保合集存储序，滤掉翻不出像素的成员（hasVaultCover 与翻牌池 /
 * 健康度同链）；skipped = 滤掉数，控件行常驻提示。
 */
// react-refresh 想让客户端文件只出组件；但设计把纯函数与本组件钉在同一文件
// （implement PR1 §1「导出 CollectionSlideshow 与 slideshowSlides」，测试直测此处）。
// eslint-disable-next-line react-refresh/only-export-components
export function slideshowSlides(members: readonly VaultMeta[]): { slides: VaultMeta[]; skipped: number } {
  const slides = members.filter(hasVaultCover);
  return { slides, skipped: members.length - slides.length };
}

/** 像素解析链（封面链同款，口径不漂移）：用户文件夹原图优先，回落 IDB/服务器第 0 页。 */
async function resolveSlideDefault(item: VaultMeta): Promise<Blob | undefined> {
  return (
    (await previewFromFolder(item)) ||
    (await getVaultBlob(item.key, 0, { localOnly: item.hasFile === false }))
  );
}

export function CollectionSlideshow({
  name,
  members,
  open,
  onClose,
  resolveSlide,
}: {
  /** 合集名（顶栏显示）。 */
  name: string;
  /** CollectionDetail 已算好的有效成员（含序）——放映顺序、详情网格、重排三者同源。 */
  members: VaultMeta[];
  open: boolean;
  onClose: () => void;
  /** 像素解析链，可注入（测试塞假 Blob）；缺省 = previewFromFolder → getVaultBlob。 */
  resolveSlide?: (item: VaultMeta) => Promise<Blob | undefined>;
}) {
  const { slides, skipped } = useMemo(() => slideshowSlides(members), [members]);
  const n = slides.length;
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(5000);
  const [shown, setShown] = useState(open);
  const [visible, setVisible] = useState(open);
  const veil = useVeil((s) => s.veil);
  // 揭示态随换页保留（Set 不清）——与详情页同张多次进出不重遮的体感一致；
  // Esc 关闭后重开是组件重挂，Set 自然归零。
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const mounted = useRef(true);
  // 幕下标 → object URL（访问过的才占内存，留供回看；上限 = 成员数 ≤ 500）。
  // URL 不进 state：渲染反应的是 slideState，URL 只在 ok 翻转那一刻被读取。
  const urls = useRef(new Map<number, string>());
  const inflight = useRef(new Map<number, Promise<void>>());
  // 失败态必须进 state 而非 ref——渲染才反应得过来（failed → 失败文案）。
  const [slideState, setSlideState] = useState(new Map<number, "loading" | "ok" | "failed">());
  // 注入的 resolveSlide 身份每渲染可能变，收进 ref 供 ensure 取最新——不进依赖避免重复触发。
  const resolveRef = useRef(resolveSlide ?? resolveSlideDefault);
  resolveRef.current = resolveSlide ?? resolveSlideDefault;

  /** 懒解析第 i 幕：已解析 / 解析中直接跳过（快速翻页、预热重叠都是空操作）。 */
  const ensure = useCallback(
    (i: number) => {
      const item = slides[i];
      if (!item || urls.current.has(i) || inflight.current.has(i)) return;
      const run = (async () => {
        // resolve 契约是返回 Promise，但注入方若同步抛（未来实现），裸 await 的
        // 异常会让 run 变无主 rejection（check P2-1）。try/catch 吞掉走 failed 态，
        // 且保持 resolveRef 的同步调用语义（.then 包裹会推迟一拍，破坏懒解析即点即发）
        let blob: Blob | undefined;
        try {
          blob = await resolveRef.current(item);
        } catch {
          blob = undefined;
        }
        // ⚠ 卸载竞态守卫（本组件唯一的真泄漏面）：await 返回时组件可能已卸载，
        // cleanup 已把现有 URL 全部 revoke——晚到的 resolve 绝不能再 createObjectURL，
        // 否则就是一个没人 revoke 的 URL。守卫必须在 createObjectURL 之前。
        if (!mounted.current) return;
        if (blob) {
          urls.current.set(i, URL.createObjectURL(blob));
          setSlideState((prev) => new Map(prev).set(i, "ok"));
        } else {
          // blob undefined = 运行期缺页（IDB 丢页/网络断）：failed 进 state，放映继续。
          setSlideState((prev) => new Map(prev).set(i, "failed"));
        }
      })();
      inflight.current.set(
        i,
        run.finally(() => inflight.current.delete(i)),
      );
    },
    [slides],
  );

  // 放映中成员被删（别处软删藏品）致 idx 越界：屏面空白至多一个 speed 拍
  // （check P2-2）——翻回可显示区间，Esc/interval 取模不受影响
  useEffect(() => {
    if (idx >= slides.length && slides.length > 0) setIdx(0);
  }, [idx, slides.length]);

  // 预热只提前两拍（照灯箱 ±2 思想）：换页即点即现，500 成员合集不会全量拉。
  useEffect(() => {
    if (!open || n === 0) return;
    ensure(idx);
    ensure((idx + 1) % n);
    ensure((idx + 2) % n);
  }, [open, idx, n, ensure]);

  // 卸载 = 关闭（CollectionDetail 条件渲染）或详情页换走：URL 全收。不逐页 revoke
  // 是有意的——URL 仍被挂载中的 <img> 引用时 revoke 会立即断图（回看闪碎图），
  // 留着只付出一个句柄；已解码位图随 <img> 卸载即释放。
  useEffect(() => {
    mounted.current = true;
    // 局部别名收 cleanup：两个 Map 都是 useRef 一次性实例、身份恒定，别名与
    // .current 等价，只为过 react-hooks 的 ref-cleanup 静态检查。
    const urlMap = urls.current;
    const pending = inflight.current;
    return () => {
      mounted.current = false;
      for (const u of urlMap.values()) URL.revokeObjectURL(u);
      urlMap.clear();
      pending.clear();
    };
  }, []);

  // 进场可见性闸照灯箱：只隔一拍翻转 opacity 触发过渡（不用 rAF，后台标签页会冻结）。
  useEffect(() => {
    if (open) {
      setShown(true);
      const id = window.setTimeout(() => setVisible(true), 30);
      return () => window.clearTimeout(id);
    }
    setVisible(false);
    const t = window.setTimeout(() => setShown(false), 300);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!shown || n === 0) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + n) % n);
      if (e.key === "ArrowRight") setIdx((i) => (i + 1) % n);
      if (e.key === " ") {
        e.preventDefault(); // 空格默认滚页，放映里只作播停
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [shown, n, onClose]);

  // 自动播放：依赖必须带 idx——手动翻页不打断播放态，但当张从头计时
  // （换页/调速/播停都整段重清重挂）。裸 setInterval（= window 版）是为 node:test
  // 假时钟可拦截（use-crossfade 同款）。
  useEffect(() => {
    if (!playing || n < 2) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % n), speed);
    return () => clearInterval(id);
  }, [playing, speed, idx, n]);

  if (!shown || n === 0) return null;
  const slide = slides[idx];
  if (!slide) return null;
  const state = slideState.get(idx) ?? "loading";
  const url = urls.current.get(idx);
  const veiledHere = veil && shouldVeil(slide) && !revealed.has(idx);

  return createPortal(
    <div
      className={cn(
        "kami-lightbox-stage fixed inset-0 z-50 flex flex-col bg-bg/95 transition-opacity duration-300 ease-out",
        visible ? "opacity-100" : "opacity-0",
      )}
      role="dialog"
      aria-modal="true"
      aria-label={`合集放映：${name}`}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 px-2">
        <p className="px-2 text-sm text-muted">{name}</p>
        <div className="ml-auto flex items-center">
          <button
            type="button"
            aria-label="关闭"
            className="flex size-11 cursor-pointer items-center justify-center rounded-sm text-fg hover:bg-elevated"
            onClick={onClose}
          >
            <X className="size-5" />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {state !== "ok" ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            {state === "loading" ? (
              <Loader2 className="size-8 animate-spin text-muted" aria-label="加载中" />
            ) : (
              <p className="text-sm text-muted">图片加载失败</p>
            )}
          </div>
        ) : null}
        {state === "ok" && url ? (
          <div className="flex size-full items-center justify-center">
            <img
              src={url}
              alt={slide.title}
              className={cn("max-h-full max-w-full object-contain", veiledHere && "blur-xl select-none")}
              draggable={false}
            />
          </div>
        ) : null}
        {/* 屏面三分点击（C1-2/C1-4）：左右各 30% 前后翻页；中间 40% 被遮先揭示，其余切播停。 */}
        <button
          type="button"
          aria-label="上一张"
          className="absolute inset-y-0 left-0 z-10 w-[30%] cursor-pointer"
          onClick={() => setIdx((i) => (i - 1 + n) % n)}
        />
        <button
          type="button"
          aria-label="下一张"
          className="absolute inset-y-0 right-0 z-10 w-[30%] cursor-pointer"
          onClick={() => setIdx((i) => (i + 1) % n)}
        />
        <button
          type="button"
          data-middle
          aria-label={veiledHere ? "揭示本张" : playing ? "暂停放映" : "继续放映"}
          className="absolute inset-y-0 left-[30%] z-10 w-[40%] cursor-pointer"
          onClick={() => {
            if (veiledHere) {
              setRevealed((prev) => new Set(prev).add(idx));
              return;
            }
            setPlaying((p) => !p);
          }}
        />
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-bg/55 px-2 py-1.5 backdrop-blur-md">
        <button
          type="button"
          aria-label={playing ? "暂停" : "播放"}
          aria-pressed={playing}
          className="flex size-9 cursor-pointer items-center justify-center rounded-sm text-fg hover:bg-elevated"
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
        </button>
        <div className="flex items-center gap-1">
          {SPEEDS.map((ms) => (
            <button
              key={ms}
              type="button"
              aria-pressed={speed === ms}
              className={cn(
                "cursor-pointer rounded-sm px-2 py-1 text-xs tabular-nums",
                speed === ms ? "bg-elevated text-fg" : "text-muted hover:text-fg",
              )}
              onClick={() => setSpeed(ms)}
            >
              {ms / 1000}s
            </button>
          ))}
        </div>
        <p className="max-w-64 truncate text-sm tabular-nums text-muted">
          {idx + 1} / {n} · <span title={slide.title}>{slide.title}</span>
        </p>
        {skipped > 0 ? <p className="text-xs text-subtle">已跳过 {skipped} 个无像素成员</p> : null}
      </div>
    </div>,
    document.body,
  );
}
