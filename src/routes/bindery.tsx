/**
 * BINDERY 装帧落地页（/bindery）：一册由流水线装订的无限画集。
 *
 * 作用：品牌叙事页——铺纸首屏（案头级自定义：排格轮换 / 拖拽·键盘编排 /
 *      托盘下场回场 / 版式架多档）+ 五工序滚动叙事（发现→检索→队列→归档→重逢，
 *      归档段滚动驱动纸匣爆炸分解与逐枚盖章）+ 奥付 × 装订工单尾屏。
 * 用法：app/bindery/page.tsx 渲染 <BinderyPage />；样式集中在 src/styles.css 的
 *      `.bindery` 段（页面钉在和纸白纸面上，是品牌定稿而非主题缺省）。
 * 为什么：交互语义来自静态提案稿（preview/pitch-d-bindery.html，浏览器实测过），
 *      档位/顺序等规则全部下沉 src/lib/bindery-hero.ts 纯函数层便于单测；
 *      爆炸分解的滚动进度走命令式 CSS 变量（--ex），不进 React 状态——
 *      滚动帧不重渲染整页。动效关停统一挂 html[data-motion="off"]。
 */
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Link } from "@/lib/kami-link";
import { cn } from "@/lib/utils";
import {
  BINDERY_GRIDS,
  BINDERY_TILE_IDS,
  addBinderyPreset,
  activeBinderyPreset,
  cloneBinderyData,
  cnDayChar,
  defaultBinderyDoc,
  gridColumns,
  gridLabel,
  loadBinderyDoc,
  moveTileBefore,
  removeBinderyPreset,
  saveBinderyDoc,
  swapByIndex,
  switchBinderyPreset,
  type BinderyHeroData,
  type BinderySlips,
} from "@/lib/bindery-hero";

/* ---------------- 小构件 ---------------- */

/** 揭示：进视口加 .on（动效关停时 CSS 直出，见 styles.css）。 */
function useSeen<T extends HTMLElement>(threshold = 0.15) {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return { ref, seen };
}

function Reveal({ className, children, style }: { className?: string; style?: CSSProperties; children: ReactNode }) {
  const { ref, seen } = useSeen<HTMLDivElement>();
  return (
    <div ref={ref} style={style} className={cn("bd-rv", seen && "on", className)}>
      {children}
    </div>
  );
}

/** 四枚図版（静态稿的生成式 SVG 平移；slice 保持铺满裁切）。 */
const TILE_META: Record<string, { title: string; src: string }> = {
  t1: { title: "夜と月", src: "図001 · pixiv · 4000×5600" },
  t2: { title: "halftone archive", src: "PLATE02 · danbooru" },
  t3: { title: "一筆書き", src: "PLATE07 · yande.re" },
  t4: { title: "print run", src: "PLATE11 · konachan · 1920×1080" },
};

function TileArt({ id }: { id: string }) {
  if (id === "t1") {
    return (
      <svg viewBox="0 0 300 210" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="300" height="210" fill="#16232B" />
        <circle cx="228" cy="62" r="34" fill="#EAF2FF" opacity=".9" />
        <path d="M0 170 L92 84 L156 148 L226 100 L300 176 L300 210 L0 210 Z" fill="#07090C" />
      </svg>
    );
  }
  if (id === "t2") {
    return (
      <svg viewBox="0 0 300 210" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="300" height="210" fill="#F4EFE4" />
        <defs>
          <pattern id="bd-t2p" width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="7" cy="7" r="3.4" fill="#141210" />
          </pattern>
        </defs>
        <rect width="300" height="210" fill="url(#bd-t2p)" opacity=".14" />
        <circle cx="150" cy="105" r="74" fill="url(#bd-t2p)" />
        <circle cx="150" cy="105" r="92" fill="none" stroke="#C93A2B" strokeWidth="2.5" />
      </svg>
    );
  }
  if (id === "t3") {
    return (
      <svg viewBox="0 0 300 210" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="300" height="210" fill="#F4EFE4" />
        <path d="M30 170 C110 20 180 190 274 44" fill="none" stroke="#141210" strokeWidth="26" strokeLinecap="round" opacity=".92" />
        <path d="M60 184 C130 60 200 200 260 90" fill="none" stroke="#C93A2B" strokeWidth="10" strokeLinecap="round" opacity=".85" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 300 210" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="300" height="210" fill="#1C2B33" />
      <defs>
        <linearGradient id="bd-t4g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E8A13C" />
          <stop offset="1" stopColor="#C93A2B" />
        </linearGradient>
      </defs>
      <circle cx="150" cy="105" r="62" fill="url(#bd-t4g)" />
      <g stroke="#1C2B33" strokeWidth="7">
        <line x1="150" y1="20" x2="150" y2="190" />
        <line x1="65" y1="105" x2="235" y2="105" />
      </g>
    </svg>
  );
}

/** 工序小图标：单线宽油墨蚀刻风（章节黑底章内用纸色描线）。 */
function ProcessIcon({ kind }: { kind: string }) {
  const common = { fill: "none", stroke: "#F4EFE4", strokeWidth: 1.5 } as const;
  if (kind === "discover")
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" {...common}>
        <rect x="2" y="2" width="5" height="5" />
        <rect x="9" y="2" width="5" height="5" />
        <rect x="5.5" y="9" width="5" height="5" />
      </svg>
    );
  if (kind === "search")
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" {...common}>
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5 L14 14" />
      </svg>
    );
  if (kind === "queue")
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" {...common}>
        <rect x="1.5" y="4" width="7" height="7" />
        <rect x="4.5" y="1" width="7" height="7" />
        <path d="M11 13 L14 13 M12.5 11.5 L14 13 L12.5 14.5" />
      </svg>
    );
  if (kind === "archive")
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" {...common}>
        <path d="M8 1.5 L14.5 4.5 L8 7.5 L1.5 4.5 Z" />
        <path d="M1.5 4.5 V11.5 L8 14.5 L14.5 11.5 V4.5" />
        <path d="M8 7.5 V14.5" />
      </svg>
    );
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" {...common}>
      <rect x="1.5" y="3" width="13" height="10" />
      <path d="M1.5 8 h13 M8 3 v10" />
      <path d="M5 14 v1.5 M11 14 v1.5" />
    </svg>
  );
}

function SectionHead({ no, icon, title, en }: { no: string; icon: string; title: string; en: string }) {
  return (
    <Reveal className="bd-sec-head">
      <span className="bd-p-no">
        <ProcessIcon kind={icon} />
        工程 {no}
      </span>
      <h2 className="bd-p-title">{title}</h2>
      <span className="bd-p-en">{en}</span>
      <span className="bd-sec-rule" />
    </Reveal>
  );
}

/* ---------------- 铺纸首屏（案头级自定义） ---------------- */

const STAMP_PLAN = [
  { id: "図001", src: "pixiv" },
  { id: "PLATE 07", src: "yande.re" },
  { id: "小説 #8801", src: "pixiv" },
] as const;
/** 盖章落点固定轮转（不随机：同刷新重放一致，也方便测试）。 */
const HANKO_SLOTS = [
  { left: 130, top: 150 },
  { left: 235, top: 205 },
  { left: 158, top: 262 },
];

function HeroDesk() {
  const [doc, setDoc] = useState(defaultBinderyDoc);
  const [work, setWork] = useState<BinderyHeroData>(() => cloneBinderyData(defaultBinderyDoc().presets[0].data));
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tray, setTray] = useState<string[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [flash, setFlash] = useState(false);
  const [sealDay, setSealDay] = useState("");
  const [drag, setDrag] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  /* 载入存档（客户端；SSR 首帧用默认，避免水合错位） */
  useEffect(() => {
    const loaded = loadBinderyDoc();
    setDoc(loaded);
    setWork(cloneBinderyData(activeBinderyPreset(loaded).data));
    setSealDay(cnDayChar(new Date().getDate()));
  }, []);

  const flashStamp = useCallback(() => {
    setFlash(true);
    setTimeout(() => setFlash(false), 1800);
  }, []);

  /** 编辑落账：用户档即时写入；内置档标「改」，引导存为新档。 */
  const commit = useCallback(
    (w: BinderyHeroData, currentDoc = doc) => {
      const active = activeBinderyPreset(currentDoc);
      if (active.builtin) {
        setDirty(true);
        return;
      }
      const next = {
        presets: currentDoc.presets.map((p) => (p.id === active.id ? { ...p, data: cloneBinderyData(w) } : p)),
        activeId: currentDoc.activeId,
      };
      setDoc(next);
      saveBinderyDoc(next);
      setDirty(false);
    },
    [doc],
  );

  const cycleGrid = () => {
    const i = BINDERY_GRIDS.findIndex(([id]) => id === work.grid);
    const w = { ...work, grid: BINDERY_GRIDS[(i + 1) % BINDERY_GRIDS.length][0] };
    setWork(w);
    commit(w);
  };

  const toTray = (id: string) => {
    const w = { ...work, order: work.order.filter((x) => x !== id) };
    setWork(w);
    setTray((t) => [...t, id]);
    commit(w);
    if (selId === id) setSelId(null);
  };
  const fromTray = (id: string) => {
    const w = { ...work, order: [...work.order, id] };
    setWork(w);
    setTray((t) => t.filter((x) => x !== id));
    commit(w);
  };

  const toggleSlip = (k: keyof BinderySlips) => {
    const w = { ...work, slips: { ...work.slips, [k]: !work.slips[k] } };
    setWork(w);
    commit(w);
  };

  /* 拖拽换位：pointer 捕获 + elementFromPoint 找落点图版 */
  useEffect(() => {
    if (!drag) return;
    const tileAt = (x: number, y: number) =>
      (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-bd-tile]")?.dataset.bdTile ?? null;
    const onMove = (e: PointerEvent) => {
      const t = tileAt(e.clientX, e.clientY);
      setHoverId(t && t !== drag ? t : null);
    };
    const finish = (e: PointerEvent) => {
      const target = tileAt(e.clientX, e.clientY);
      if (target && target !== drag) {
        const w = { ...work, order: moveTileBefore(work.order, drag, target) };
        setWork(w);
        commit(w);
      }
      setDrag(null);
      setHoverId(null);
    };
    const cancel = () => {
      setDrag(null);
      setHoverId(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [drag, work, commit]);

  const onTileKey = (e: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
    if (!editing) return;
    if (e.key === "Escape") {
      e.currentTarget.blur();
      return;
    }
    const i = work.order.indexOf(id);
    const cols = gridColumns(work.grid);
    let j = -1;
    if (e.key === "ArrowLeft") j = i - 1;
    else if (e.key === "ArrowRight") j = i + 1;
    else if (e.key === "ArrowUp") j = i - cols;
    else if (e.key === "ArrowDown") j = i + cols;
    else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      toTray(id);
      return;
    } else return;
    e.preventDefault();
    if (j < 0 || j >= work.order.length) return;
    const w = { ...work, order: swapByIndex(work.order, i, j) };
    setWork(w);
    commit(w);
  };

  const onTileDown = (e: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (!editing) return;
    setDrag(id);
  };

  /* 版式架操作 */
  const switchPreset = (id: string) => {
    const next = switchBinderyPreset(doc, id);
    if (next === doc) return;
    setDoc(next);
    saveBinderyDoc(next);
    setWork(cloneBinderyData(activeBinderyPreset(next).data));
    setDirty(false);
    setTray([]);
  };
  const deletePreset = (id: string) => {
    const next = removeBinderyPreset(doc, id);
    if (next === doc) return;
    const wasActive = doc.activeId === id;
    setDoc(next);
    saveBinderyDoc(next);
    if (wasActive) {
      setWork(cloneBinderyData(activeBinderyPreset(next).data));
      setDirty(false);
      setTray([]);
    }
  };
  const savePreset = () => {
    const { doc: next } = addBinderyPreset(doc, name, work);
    setDoc(next);
    saveBinderyDoc(next);
    setDirty(false);
    setName("");
    flashStamp();
  };

  const toggleEdit = () => {
    setEditing((v) => {
      if (v) {
        setSelId(null);
        flashStamp();
      }
      return !v;
    });
  };

  const active = activeBinderyPreset(doc);

  return (
    <section className="bd-hero" data-edit={editing ? "1" : "0"}>
      <Reveal className="bd-stage-head">
        <p className="bd-kicker">KAMI-PAPERBOX · BINDERY — 一册由流水线装订的画集</p>
        <p className="bd-hero-meta">工程 5 道 / 出典 4 源 / 裝幀 和紙 × 油墨 × 朱印 × 牛皮紙（機械件）</p>
      </Reveal>
      <div className="bd-hero-main">
        <div className="bd-layzone">
          <div className="bd-sheet-label">
            <span>今日的纸 · 铺纸</span>
            <span className="bd-laytools">
              <button type="button" className="bd-laybtn" onClick={cycleGrid}>
                格：{gridLabel(work.grid)}
              </button>
              <button type="button" className="bd-laybtn bd-laybtn-edit" aria-pressed={editing} onClick={toggleEdit}>
                {editing ? "完了" : "編輯"}
              </button>
              <span className={cn("bd-stamp-done", flash && "show")} lang="ja">
                整理済
              </span>
            </span>
          </div>
          <div className="bd-hero-seal" lang="ja">
            今日の紙<small>{sealDay || "·"}</small>
          </div>
          <div className="bd-strip" data-layout={work.grid}>
            {work.order.map((id) => (
              <button
                key={id}
                type="button"
                data-bd-tile={id}
                className={cn("bd-tile", drag === id && "dragging", hoverId === id && "ghost", editing && selId === id && "sel")}
                aria-pressed={editing && selId === id}
                onPointerDown={(e) => onTileDown(e, id)}
                onFocus={() => editing && setSelId(id)}
                onBlur={() => setSelId((s) => (s === id ? null : s))}
                onKeyDown={(e) => onTileKey(e, id)}
              >
                <TileArt id={id} />
                <footer>
                  <b>{TILE_META[id]?.title}</b>
                  <span>{TILE_META[id]?.src}</span>
                </footer>
              </button>
            ))}
          </div>
          <p className="bd-layhint">編輯模式 — 拖拽换位 · 方向键搬移 · Delete 下场入托盘 · Esc 取消选中</p>
          <div className="bd-shelf-row">
            <span className="bd-shelf-lbl">版式架</span>
            {doc.presets.map((p) => (
              <span key={p.id} className={cn("bd-pchip", p.builtin && "builtin", p.id === doc.activeId && "cur", p.builtin && dirty && p.id === doc.activeId && "dirty")}>
                <button type="button" aria-current={p.id === doc.activeId} onClick={() => switchPreset(p.id)}>
                  {p.name}
                  {p.builtin && dirty && p.id === doc.activeId ? "・改" : ""}
                </button>
                {!p.builtin ? (
                  <button type="button" className="bd-px" aria-label={`删除档位 ${p.name}`} onClick={() => deletePreset(p.id)}>
                    ×
                  </button>
                ) : null}
              </span>
            ))}
            <input
              className="bd-save-input"
              value={name}
              maxLength={8}
              placeholder="新档名…"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && savePreset()}
            />
            <button type="button" className="bd-laybtn" aria-label="存为新档" onClick={savePreset}>
              存为新档
            </button>
          </div>
          {active.builtin ? <p className={cn("bd-shelf-hint", dirty && "on")}>内置档不可改 — 「存为新档」以保留当前摆法；切档将丢弃未存改动</p> : null}
        </div>
        <div className="bd-slips">
          {(
            [
              ["letters", "信夹", "03", [["三日月", "pixiv · 日榜"], ["白井", "FANBOX · 更新"], ["海岸线", "konachan · 周刊"]]],
              ["stack", "纸叠", "2", [["図0231", "下載中 64%"], ["図0232", "待機"]]],
              ["wall", "画师墙", "3×3", [["三日月", "新作 ×2"], ["白井", "新作 ×1"], ["海岸线", "新作 ×5"]]],
            ] as const
          ).map(([key, label, count, rows]) => (
            <section key={key} data-slip={key} className={cn("bd-slip", !work.slips[key] && "folded")}>
              <header>
                <span>{label}</span>
                <span>{count}</span>
                <button type="button" className="bd-slip-x" onClick={() => toggleSlip(key)}>
                  {work.slips[key] ? "收" : "展"}
                </button>
              </header>
              <ul>
                {rows.map(([t, s]) => (
                  <li key={t}>
                    <button type="button">
                      {t}
                      <span>{s}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section className={cn("bd-slip bd-tray", tray.length > 0 && "on")}>
            <header>
              <span>托盘</span>
              <span>{tray.length}</span>
            </header>
            <ul>
              {tray.map((id) => (
                <li key={id}>
                  <button type="button" className="bd-tray-back" onClick={() => fromTray(id)}>
                    {id} · 回场<span>↩</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      <Reveal className="bd-hero-foot">
        <form className="bd-find" onSubmit={(e) => e.preventDefault()}>
          <label htmlFor="bd-q">检索</label>
          <input id="bd-q" placeholder="标签、链接或作品号" readOnly />
        </form>
        <Link to="/">← 返回案头</Link>
        <Link to="/search">工序 · 檢索</Link>
        <Link to="/queue">笺 · 隊列</Link>
        <Link to="/vault">印 · 紙匣</Link>
        <span className="bd-hf-meta" lang="ja">
          五つの工程で、一册の畫集を。
        </span>
      </Reveal>
    </section>
  );
}

/* ---------------- 工序 02：检索台打字机 ---------------- */

const DEMO_QUERIES = [
  "tag:夜空 rating:s size:≥3508",
  "pixiv 小説 長篇 #SF",
  "konachan wallpaper 1920×1080",
  "yande.re rating:s order:score",
];

function SearchConsole() {
  const [query, setQuery] = useState("");
  useEffect(() => {
    let qi = 0;
    let i = 0;
    let del = false;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const text = DEMO_QUERIES[qi];
      if (!del) {
        i += 1;
        setQuery(text.slice(0, i));
        if (i >= text.length) {
          del = true;
          timer = setTimeout(step, 1700);
          return;
        }
        timer = setTimeout(step, 46);
      } else {
        i -= 1;
        setQuery(text.slice(0, i));
        if (i <= 0) {
          del = false;
          qi = (qi + 1) % DEMO_QUERIES.length;
          timer = setTimeout(step, 300);
          return;
        }
        timer = setTimeout(step, 14);
      }
    };
    timer = setTimeout(step, 600);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="bd-searchbox">
      <div className="bd-search-row">
        <span className="bd-prompt">◉</span>
        <input aria-label="检索演示" value={query} readOnly />
        <span className="bd-demo-tag">DEMO</span>
      </div>
      <div className="bd-chips">
        <span className="bd-chip hot">#夜空</span>
        <span className="bd-chip">rating:s</span>
        <span className="bd-chip">≥3508px</span>
        <span className="bd-chip">pixiv 小説</span>
        <span className="bd-chip">壁纸 1920×1080</span>
      </div>
      <div className="bd-results">
        <div className="bd-res-row">
          <span className="bd-th">
            <svg viewBox="0 0 44 32">
              <rect width="44" height="32" fill="#16232B" />
              <circle cx="33" cy="9" r="5" fill="#EAF2FF" opacity=".9" />
              <path d="M0 26 L13 12 L23 22 L33 15 L44 27 L44 32 L0 32Z" fill="#07090C" />
            </svg>
          </span>
          <span>図0231 · 4 源归并</span>
          <span className="bd-st">✓ 最佳品質 pixiv</span>
        </div>
        <div className="bd-res-row">
          <span className="bd-th">
            <svg viewBox="0 0 44 32">
              <rect width="44" height="32" fill="#F4EFE4" />
              <path d="M5 26 C16 3 26 28 39 7" fill="none" stroke="#141210" strokeWidth="4" strokeLinecap="round" />
            </svg>
          </span>
          <span>図0232 · yande.re</span>
          <span className="bd-st">3508×4961</span>
        </div>
        <div className="bd-res-row">
          <span className="bd-th">
            <svg viewBox="0 0 44 32">
              <rect width="44" height="32" fill="#1C2B33" />
              <circle cx="22" cy="16" r="9" fill="#C93A2B" />
              <path d="M22 4v24M10 16h24" stroke="#1C2B33" strokeWidth="2.5" />
            </svg>
          </span>
          <span>図0233 · konachan</span>
          <span className="bd-st">壁纸档</span>
        </div>
        <div className="bd-res-row">
          <span className="bd-th">
            <svg viewBox="0 0 44 32">
              <rect width="44" height="32" fill="#F4EFE4" />
              <g stroke="#141210" strokeWidth="1">
                <path d="M12 5v22" />
                <path d="M18 5v22" />
                <path d="M24 5v22" />
                <path d="M30 5v22" />
              </g>
              <rect x="14" y="9" width="4" height="6" fill="#141210" transform="rotate(180 16 12)" />
            </svg>
          </span>
          <span>小説 #8801 · pixiv</span>
          <span className="bd-st">縦書 12,400 字</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 工序 03：牛皮纸传送带 ---------------- */

function QueueBelt() {
  const cards = (
    <>
      <div className="bd-qcard">
        <svg viewBox="0 0 160 90" aria-hidden="true">
          <rect width="160" height="90" fill="#16232B" />
          <circle cx="118" cy="26" r="16" fill="#EAF2FF" opacity=".9" />
          <path d="M0 74 L46 42 L78 64 L112 50 L160 78 L160 90 L0 90Z" fill="#07090C" />
        </svg>
        <div className="bd-bar">
          <i />
        </div>
        <div className="bd-qmeta">
          <span>図0231</span>
          <span className="bd-stmap dl">下載中</span>
        </div>
      </div>
      <div className="bd-qcard">
        <svg viewBox="0 0 160 90" aria-hidden="true">
          <rect width="160" height="90" fill="#F4EFE4" />
          <path d="M20 74 C58 12 96 82 144 24" fill="none" stroke="#141210" strokeWidth="13" strokeLinecap="round" />
          <path d="M34 80 C70 32 104 86 138 48" fill="none" stroke="#C93A2B" strokeWidth="5" strokeLinecap="round" />
        </svg>
        <div className="bd-bar">
          <i />
        </div>
        <div className="bd-qmeta">
          <span>図0232</span>
          <span className="bd-stmap wait">待機</span>
        </div>
      </div>
      <div className="bd-qcard">
        <svg viewBox="0 0 160 90" aria-hidden="true">
          <rect width="160" height="90" fill="#1C2B33" />
          <circle cx="80" cy="42" r="26" fill="#C93A2B" />
          <g stroke="#1C2B33" strokeWidth="4">
            <line x1="80" y1="10" x2="80" y2="74" />
            <line x1="44" y1="42" x2="116" y2="42" />
          </g>
        </svg>
        <div className="bd-bar">
          <i />
        </div>
        <div className="bd-qmeta">
          <span>図0233</span>
          <span className="bd-stmap dl">下載中</span>
        </div>
      </div>
      <div className="bd-qcard">
        <svg viewBox="0 0 160 90" aria-hidden="true">
          <rect width="160" height="90" fill="#F4EFE4" />
          <g stroke="#141210" strokeWidth="1.6">
            <path d="M48 12v66" />
            <path d="M66 12v66" />
            <path d="M84 12v66" />
            <path d="M102 12v66" />
          </g>
          <g fill="#141210">
            <rect x="44" y="24" width="8" height="18" transform="rotate(180 48 33)" />
            <rect x="62" y="38" width="8" height="24" transform="rotate(180 66 50)" />
            <rect x="80" y="24" width="8" height="16" transform="rotate(180 84 32)" />
          </g>
        </svg>
        <div className="bd-bar">
          <i />
        </div>
        <div className="bd-qmeta">
          <span>小説 #8801</span>
          <span className="bd-stmap done">完了 ✓</span>
        </div>
      </div>
      <div className="bd-qcard">
        <svg viewBox="0 0 160 90" aria-hidden="true">
          <rect width="160" height="90" fill="#EDE4D0" />
          <rect x="18" y="12" width="58" height="34" fill="#141210" />
          <rect x="84" y="12" width="58" height="34" fill="#2E7F8F" />
          <rect x="18" y="52" width="124" height="26" fill="#141210" />
          <text x="26" y="69" fill="#F4EFE4" fontFamily="monospace" fontSize="9" letterSpacing="3">
            1BOX=4SEAS
          </text>
        </svg>
        <div className="bd-bar">
          <i />
        </div>
        <div className="bd-qmeta">
          <span>図0234</span>
          <span className="bd-stmap wait">待機</span>
        </div>
      </div>
    </>
  );
  return (
    <div className="bd-belt-frame">
      <div className="bd-belt">
        <div className="bd-bgroup">{cards}</div>
        <div className="bd-bgroup" aria-hidden="true">
          {cards}
        </div>
      </div>
    </div>
  );
}

/* ---------------- 工序 04：归档（滚动爆炸 + 逐枚盖章） ---------------- */

function ArchiveStage() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const xbRef = useRef<HTMLDivElement | null>(null);
  const [stamped, setStamped] = useState<{ id: string; src: string; time: string }[]>([]);

  useEffect(() => {
    const sec = sectionRef.current;
    if (!sec) return;
    let raf = 0;
    const thresholds = [0.28, 0.58, 0.86];
    const update = () => {
      raf = 0;
      const r = sec.getBoundingClientRect();
      const total = Math.max(1, r.height - window.innerHeight);
      const pr = Math.min(1, Math.max(0, -r.top / total));
      xbRef.current?.style.setProperty("--ex", pr.toFixed(3));
      const want = thresholds.filter((t) => pr > t).length;
      setStamped((prev) => {
        if (want <= prev.length) return prev;
        const now = new Date();
        const p = (n: number) => String(n).padStart(2, "0");
        const time = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
        return [...prev, ...STAMP_PLAN.slice(prev.length, want).map((s) => ({ ...s, time }))];
      });
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section className="bd-archive-sec" id="bd-p4" ref={sectionRef}>
      <div className="bd-archive-stick">
        <SectionHead no="04" icon="archive" title="归 档" en="Archive — exploded & stamped" />
        <div className="bd-arch-grid">
          <div className="bd-xb-wrap" ref={xbRef}>
            <svg className="bd-axis" viewBox="0 0 40 560" aria-hidden="true">
              <line x1="8" y1="0" x2="8" y2="560" stroke="#141210" />
              <g stroke="#141210">
                <line x1="0" y1="40" x2="16" y2="40" />
                <line x1="0" y1="140" x2="16" y2="140" />
                <line x1="0" y1="240" x2="16" y2="240" />
                <line x1="0" y1="340" x2="16" y2="340" />
                <line x1="0" y1="440" x2="16" y2="440" />
                <line x1="0" y1="540" x2="16" y2="540" />
              </g>
            </svg>
            <div className="bd-xb-layer bd-xb-l1">
              <span className="bd-lid-tag">L-01 蓋</span>
              <span className="bd-nm">展览墙</span>
              <span className="bd-spec">
                随时重逢
                <br />
                REUNITE
              </span>
            </div>
            <div className="bd-xb-layer bd-xb-l2">
              <span className="bd-lid-tag">L-02</span>
              <span className="bd-nm">馆藏库</span>
              <span className="bd-spec">
                本地匣 · 全文检索
                <br />
                ARCHIVE
              </span>
            </div>
            <div className="bd-xb-layer bd-xb-l3">
              <span className="bd-lid-tag">L-03</span>
              <span className="bd-nm">下载队列</span>
              <span className="bd-spec">
                限速 · 重试 · 校验
                <br />
                QUEUE
              </span>
            </div>
            <div className="bd-xb-layer bd-xb-l4">
              <span className="bd-lid-tag">L-04 底</span>
              <span className="bd-nm">聚合检索</span>
              <span className="bd-spec">
                四源一网
                <br />
                AGGREGATE
              </span>
            </div>
            <span className="bd-xb-base" />
          </div>
          <div>
            <p className="bd-p-copy bd-arch-copy">
              集大成的一站——匣子在此逐层展开：<b>聚合检索是底，队列是中层，馆藏是身，展览墙是盖</b>。
              滚过这段，入队的藏品逐枚盖上朱印，钉进蔷書票。
            </p>
            <div className="bd-ex-card">
              <h3 lang="ja">紙匣藏書</h3>
              <div className="bd-vframe">
                <svg viewBox="0 0 300 210" aria-hidden="true">
                  <rect width="300" height="210" fill="#F4EFE4" />
                  <defs>
                    <pattern id="bd-hx" width="14" height="14" patternUnits="userSpaceOnUse">
                      <circle cx="7" cy="7" r="3.4" fill="#141210" />
                    </pattern>
                  </defs>
                  <rect width="300" height="210" fill="url(#bd-hx)" opacity=".14" />
                  <circle cx="150" cy="105" r="66" fill="url(#bd-hx)" />
                  <circle cx="150" cy="105" r="84" fill="none" stroke="#C93A2B" strokeWidth="2.5" />
                </svg>
              </div>
              {stamped.map((s, i) => (
                <span key={s.id} className="bd-hanko" style={HANKO_SLOTS[i % HANKO_SLOTS.length]}>
                  匣
                  <small>{s.id}</small>
                </span>
              ))}
              <div className="bd-ex-list">
                {stamped.length === 0 ? "（滾動此段 — 藏品逐枚入庫 / scroll to stamp）" : stamped.map((s) => (
                  <span key={s.id}>
                    {s.id} · {s.src} · 入庫 {s.time}
                    <br />
                  </span>
                ))}
              </div>
              <div className="bd-ex-count">入庫 {stamped.length} 点</div>
            </div>
            <p className="bd-ex-hint">{stamped.length >= STAMP_PLAN.length ? "✓ 三枚入庫完畢 — 匣は満ちてゆく" : "↑ 繼續滾動 — 逐層分解 · 逐枚蓋章"}</p>
          </div>
        </div>
        <p className="bd-xb-labels">SCROLL TO EXPLODE · SN-001 · 精度 0.1mm · 朱印 #C93A2B</p>
      </div>
    </section>
  );
}

/* ---------------- 工序 05：書架墙 ---------------- */

function ShelfFrame({ i, taken, children, src }: { i: number; taken?: boolean; children: ReactNode; src: string }) {
  const { ref, seen } = useSeen<HTMLElement>(0.4);
  return (
    <figure ref={ref} className={cn("bd-frame", seen && "on", taken && "taken")} style={{ transitionDelay: `${(i % 4) * 140}ms` }}>
      {taken ? <span className="bd-card-out">{children}</span> : children}
      <figcaption>
        <span>匣-{String(i + 1).padStart(3, "0")}</span>
        <span>{src}</span>
      </figcaption>
    </figure>
  );
}

/* ---------------- 页面 ---------------- */

const PROCS = [
  { id: "bd-p1", label: "01 發現" },
  { id: "bd-p2", label: "02 檢索" },
  { id: "bd-p3", label: "03 隊列" },
  { id: "bd-p4", label: "04 歸檔" },
  { id: "bd-p5", label: "05 重逢" },
] as const;

export function BinderyPage() {
  const [proc, setProc] = useState("");
  const [accepted, setAccepted] = useState(false);
  const finale = useSeen<HTMLDivElement>(0.6);

  /* 左栏工程导航 scroll-spy */
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setProc(e.target.id);
        }
      },
      { threshold: 0.3 },
    );
    for (const { id } of PROCS) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  const plates = useMemo(
    () =>
      BINDERY_TILE_IDS.map((id) => ({ id, data: TILE_META[id] })),
    [],
  );

  return (
    <div className="bindery">
      <nav className="bd-rail" aria-label="工程导航">
        <span className="bd-rail-title" lang="ja">
          流ヲ、冊ヘ。
        </span>
        {PROCS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-current={proc === p.id}
            onClick={() => document.getElementById(p.id)?.scrollIntoView({ behavior: "smooth" })}
          >
            {p.label}
          </button>
        ))}
        <span className="bd-rail-cue" lang="ja">
          裝丁ヲ始メル
        </span>
      </nav>

      <div className="bd-body">
        <HeroDesk />

        {/* 01 发现 */}
        <section className="bd-process" id="bd-p1">
          <SectionHead no="01" icon="discover" title="发 现" en="Discover — four seas, one net" />
          <div className="bd-two-col">
            <Reveal>
              <p className="bd-p-copy">
                四片性格迥异的海，在工房上空汇成一张网。<b>pixiv 的画廊、danbooru 的档案馆、yande.re 的矿脉、konachan
                的印刷厂</b>——同一张网打捞四个世界，同一张插画，多源归并成一张図版。
              </p>
              <div className="bd-stat-list">
                <b>SRC-01</b> pixiv — 插画 / 漫画 / 小说 全形态
                <br />
                <b>SRC-02</b> danbooru — 数万标签级档案索引
                <br />
                <b>SRC-03</b> yande.re — 高分辨率高质量筛选
                <br />
                <b>SRC-04</b> konachan — 1920×1080 壁纸专供
              </div>
            </Reveal>
            <Reveal className="bd-plates2">
              {plates.map(({ id }) => (
                <figure key={id} className="bd-plate">
                  <div className="bd-art">
                    <TileArt id={id} />
                  </div>
                  <figcaption>
                    {(() => {
                      const parts = TILE_META[id].src.split(" · ");
                      const source = parts[1] ?? parts[0];
                      const tail = parts.at(-1);
                      return (
                        <>
                          <span>
                            <b>{parts[0]}</b>
                            {" · "}
                            {source}
                          </span>
                          <span>{tail !== source ? tail : ""}</span>
                        </>
                      );
                    })()}
                  </figcaption>
                </figure>
              ))}
            </Reveal>
          </div>
          <Reveal className="bd-panel-wrap">
            <div className="bd-panel bd-seamap" data-sn="FIG.1-1 四海域汇流図（印刷制図風）">
              <svg viewBox="0 0 720 190" aria-hidden="true">
                <path className="bd-route" d="M110 40 C240 60 320 78 352 92" />
                <path className="bd-route" d="M110 150 C240 130 320 112 352 98" />
                <path className="bd-route" d="M610 40 C480 60 400 78 368 92" />
                <path className="bd-route" d="M610 150 C480 130 400 112 368 98" />
                <g className="bd-node">
                  <circle cx="110" cy="40" r="26" />
                  <text x="110" y="12" textAnchor="middle">pixiv</text>
                </g>
                <g className="bd-node">
                  <circle cx="110" cy="150" r="26" />
                  <text x="110" y="184" textAnchor="middle">danbooru</text>
                </g>
                <g className="bd-node">
                  <circle cx="610" cy="40" r="26" />
                  <text x="610" y="12" textAnchor="middle">yande.re</text>
                </g>
                <g className="bd-node">
                  <circle cx="610" cy="150" r="26" />
                  <text x="610" y="184" textAnchor="middle">konachan</text>
                </g>
                <rect x="334" y="76" width="52" height="38" fill="#C93A2B" />
                <text x="360" y="101" textAnchor="middle" fill="#F4EFE4" fontSize="19" fontWeight="900" fontFamily="serif">
                  匣
                </text>
                <rect x="324" y="66" width="72" height="58" fill="none" stroke="#C93A2B" strokeDasharray="4 5" />
                <text x="360" y="152" textAnchor="middle" fontSize="9" letterSpacing="3" fill="#4A4238">
                  紙匣 KAMI · AGGREGATION
                </text>
              </svg>
            </div>
          </Reveal>
        </section>

        {/* 02 检索 */}
        <section className="bd-process" id="bd-p2">
          <SectionHead no="02" icon="search" title="检 索" en="Search — one line, four grammars" />
          <div className="bd-two-col">
            <Reveal className="bd-panel" data-sn="FIG.2-1 検索コンソール">
              <SearchConsole />
            </Reveal>
            <Reveal>
              <p className="bd-p-copy">
                比对台。跨站语法混写，一处生效——<b>pixiv 的标签、booru 系的 rating:、yande.re 的尺寸下限</b>
                ，在同一行查询里相互翻译。同图多源自动归并，候选清单只剩「最好的那一份」。
              </p>
              <div className="bd-stat-list">
                <b>QRY-A</b> 跨站标签互译 · 同图归并
                <br />
                <b>QRY-B</b> safe / R-18 每站独立档位
                <br />
                <b>QRY-C</b> 以图搜匣 — 本地反查出处
              </div>
            </Reveal>
          </div>
        </section>

        {/* 03 队列 */}
        <section className="bd-process" id="bd-p3">
          <SectionHead no="03" icon="queue" title="队 列" en="Download — the conveyor never sleeps" />
          <Reveal>
            <p className="bd-p-copy bd-queue-copy">
              下载是一条永不停歇的传送带：<b>限速、重试、校验、去重</b>，每张図版在带上有自己的工位与状态章。
              断网不是事故，只是传送带暂停——恢复后从断点继续，一张不丢。
            </p>
          </Reveal>
          <Reveal>
            <QueueBelt />
          </Reveal>
          <Reveal className="bd-qstats">
            <span>
              同時下載<b>6</b>
            </span>
            <span>
              重試成功率<b>99.2%</b>
            </span>
            <span>
              斷點續傳<b>✓</b>
            </span>
            <span>
              SHA 校驗<b>✓</b>
            </span>
          </Reveal>
        </section>

        {/* 04 归档 */}
        <ArchiveStage />

        {/* 05 重逢 */}
        <section className="bd-process" id="bd-p5">
          <SectionHead no="05" icon="reunite" title="重 逢" en="Reunite — the plate shelf" />
          <Reveal>
            <p className="bd-p-copy bd-queue-copy">
              最后一道工序没有机器——<b>是你亲手把画集放上墙</b>。离线的匣、本地的墙、标签即索引；
              任何时候取下一帧，它就在原地等你。流水线的终点，是重逢。
            </p>
          </Reveal>
          <Reveal className="bd-shelf">
            <ShelfFrame i={0} src="pixiv">
              <svg viewBox="0 0 160 100" aria-hidden="true">
                <rect width="160" height="100" fill="#16232B" />
                <circle cx="118" cy="28" r="17" fill="#EAF2FF" opacity=".92" />
                <path d="M0 82 L46 48 L80 70 L114 56 L160 84 L160 100 L0 100Z" fill="#07090C" />
              </svg>
            </ShelfFrame>
            <ShelfFrame i={1} src="danbooru">
              <svg viewBox="0 0 160 100" aria-hidden="true">
                <rect width="160" height="100" fill="#F4EFE4" />
                <defs>
                  <pattern id="bd-r2" width="12" height="12" patternUnits="userSpaceOnUse">
                    <circle cx="6" cy="6" r="3" fill="#141210" />
                  </pattern>
                </defs>
                <rect width="160" height="100" fill="url(#bd-r2)" opacity=".15" />
                <circle cx="80" cy="46" r="34" fill="url(#bd-r2)" />
                <circle cx="80" cy="46" r="44" fill="none" stroke="#C93A2B" strokeWidth="2" />
              </svg>
            </ShelfFrame>
            <ShelfFrame i={2} src="yande.re" taken>
              <svg viewBox="0 0 160 100" aria-hidden="true">
                <rect width="160" height="100" fill="#F4EFE4" />
                <path d="M22 82 C60 14 98 86 144 22" fill="none" stroke="#141210" strokeWidth="13" strokeLinecap="round" />
                <path d="M36 88 C72 34 106 90 138 46" fill="none" stroke="#C93A2B" strokeWidth="5" strokeLinecap="round" />
              </svg>
            </ShelfFrame>
            <ShelfFrame i={3} src="konachan">
              <svg viewBox="0 0 160 100" aria-hidden="true">
                <rect width="160" height="100" fill="#1C2B33" />
                <circle cx="80" cy="46" r="28" fill="#C93A2B" />
                <g stroke="#1C2B33" strokeWidth="5">
                  <line x1="80" y1="12" x2="80" y2="80" />
                  <line x1="42" y1="46" x2="118" y2="46" />
                </g>
              </svg>
            </ShelfFrame>
            <ShelfFrame i={4} src="pixiv 小説">
              <svg viewBox="0 0 160 100" aria-hidden="true">
                <rect width="160" height="100" fill="#F4EFE4" />
                <g stroke="#141210" strokeWidth="1.6">
                  <path d="M52 12v76" />
                  <path d="M72 12v76" />
                  <path d="M92 12v76" />
                  <path d="M112 12v76" />
                </g>
                <g fill="#141210">
                  <rect x="47" y="26" width="10" height="20" transform="rotate(180 52 36)" />
                  <rect x="67" y="42" width="10" height="26" transform="rotate(180 72 55)" />
                  <rect x="87" y="26" width="10" height="18" transform="rotate(180 92 35)" />
                </g>
                <circle cx="112" cy="66" r="9" fill="#C93A2B" />
              </svg>
            </ShelfFrame>
            <ShelfFrame i={5} src="跨源合册">
              <svg viewBox="0 0 160 100" aria-hidden="true">
                <rect width="160" height="100" fill="#EDE4D0" />
                <rect x="18" y="12" width="58" height="34" fill="#141210" />
                <rect x="84" y="12" width="58" height="34" fill="#2E7F8F" />
                <rect x="18" y="52" width="124" height="30" fill="#141210" />
                <text x="26" y="71" fill="#F4EFE4" fontFamily="monospace" fontSize="9" letterSpacing="3">
                  1BOX=4SEAS
                </text>
              </svg>
            </ShelfFrame>
            <ShelfFrame i={6} src="pixiv">
              <svg viewBox="0 0 160 100" aria-hidden="true">
                <rect width="160" height="100" fill="#16232B" />
                <path d="M0 66 L60 30 L104 56 L160 34 L160 100 L0 100Z" fill="#07090C" />
                <circle cx="128" cy="24" r="10" fill="#EAF2FF" opacity=".85" />
              </svg>
            </ShelfFrame>
            <ShelfFrame i={7} src="合册表纸">
              <svg viewBox="0 0 160 100" aria-hidden="true">
                <rect width="160" height="100" fill="#F4EFE4" />
                <circle cx="80" cy="50" r="36" fill="none" stroke="#141210" strokeWidth="1.4" />
                <circle cx="80" cy="50" r="22" fill="#C93A2B" />
                <g stroke="#141210" strokeWidth="1">
                  <line x1="80" y1="6" x2="80" y2="94" />
                  <line x1="36" y1="50" x2="124" y2="50" />
                </g>
              </svg>
            </ShelfFrame>
          </Reveal>
        </section>

        {/* 尾屏：奥付 × 装订工单 */}
        <section className="bd-finale" id="bd-finale">
          <Reveal className="bd-colophon-grid">
            <div>
              <b>発行</b> 紙匣製作所 KAMI-PAPERBOX
              <br />
              <b>編集</b> あなた（所有者即編纂者）
              <br />
              <b>裝幀</b> 和紙 × 油墨 × 朱印 × 牛皮紙（機械件）
              <br />
              <b>図版出典</b> pixiv / danbooru / yande.re / konachan
              <br />
              <b>刷次</b> 無限 — 匣不封頂，隨入隨刷
            </div>
            <p className="bd-bigline" lang="ja">
              刷るほどに、匣は厚くなる。
              <br />
              ——あなたの畫集は、まだ書き終わらない。
            </p>
          </Reveal>
          <Reveal className="bd-order">
            <span className={cn("bd-accept-stamp", accepted && "on")}>
              <span className="jp" lang="ja">
                受付済
              </span>
              <span className="en">ORDER ACCEPTED</span>
            </span>
            <p className="bd-order-k">裝丁工單 · WORK ORDER</p>
            <h2>你的第一部「无限画集」现在开印</h2>
            <div className="bd-order-grid">
              <b>品 名</b> 個人畫集 · 紙匣藏
              <br />
              <b>冊 数</b> 無限 — 匣不封頂
              <br />
              <b>納 期</b> 一生 — 隨入隨刷
              <br />
              <b>取 引</b> 全部在你自己的電腦上完成
            </div>
            <div className="bd-cta">
              <button type="button" className="bd-big-btn" onClick={() => setAccepted(true)}>
                {accepted ? "受付済 — ACCEPTED ✓" : "開始裝訂 — START"}
              </button>
              <span className="bd-order-note">※ 落地页演示 · 点击盖章即可视作下单成功</span>
            </div>
          </Reveal>
          <div ref={finale.ref} className={cn("bd-visitor-stamp", finale.seen && "on")}>
            <span className="jp" lang="ja">
              閲覧済
            </span>
            <span className="en">VISITED · KAMI</span>
          </div>
        </section>
      </div>
    </div>
  );
}
