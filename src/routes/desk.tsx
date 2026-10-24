/**
 * 今日案头（主页稿纸，槽模型渲染 + 编排模式）。
 *
 * 作用：打开应用落到这里；按激活版式的槽编排摆模块（铺纸/报纸/信/纸叠/墙），
 *      去年今日笺挂页眉；「编排」进入编辑态直接摆真实页面（拖拽/键盘/托盘）。
 * 用法：app/page.tsx 渲染 DeskPage；?edit=1 深链直达编辑态（读完即从地址摘掉）。
 * 为什么：浏览是工作面，案头是坐下的那张纸；编排数据在设置段（v18），
 *        默认版式逐项复刻 2026-10 合并版观感——不碰设置的用户零感知。
 *        编辑态 draft 在组件内，完成才落 store（内置稿纸不可写 → 引导存为版式）。
 */
"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DESK_MODULE_NODES } from "@/components/desk/desk-registry";
import {
  DeskEditBar,
  DeskEditCard,
  DeskEditSlot,
  DeskSaveAsDialog,
  type DeskDrag,
} from "@/components/desk/desk-edit";
import { unreadItems } from "@/lib/desk-unread";
import {
  DEFAULT_DESK_LAYOUT,
  DESK_DEFAULT_PRESET_ID,
  DESK_MODULE_IDS,
  reflowDeskLayout,
  type DeskLayout,
  type DeskModuleId,
} from "@/lib/desk-layout";
import { Link, useNavigate } from "@/lib/kami-link";
import { onThisDay, onThisDaySlipLine } from "@/lib/storage/vault-profile";
import { mergeVaultItems } from "@/lib/storage/vault-query";
import { listVault, type VaultMeta } from "@/lib/storage/vault";
import { listServerVault } from "@/lib/storage/vault-sync";
import { useSettings, useSettingsHydrated } from "@/lib/store";
import { useActiveThemePack } from "@/lib/theme-pack-client";
import { useViewHistory } from "@/lib/view-history";
import { cn } from "@/lib/utils";

function todayLabel(now = new Date()): { title: string; date: string } {
  const date = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(now);
  return { title: "今日", date };
}

/** 槽宽 → 网格列类（lg 起三列稿纸；移动端单列堆叠）。 */
const SPAN_CLASS: Record<1 | 2 | 3, string> = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
};

/** 槽内/跨槽搬模块（不可变写法）；载荷位置对不上时按实际位置找，找不到不动。 */
function moveModuleInDraft(prev: DeskLayout, id: DeskModuleId, fromSlot: number, fromIndex: number, toSlot: number, toIndex: number): DeskLayout {
  const slots = prev.slots.map((s) => ({ ...s, items: [...s.items] }));
  if (slots[fromSlot]?.items[fromIndex] !== id) {
    let found = false;
    for (let s = 0; s < slots.length && !found; s += 1) {
      const i = slots[s]!.items.indexOf(id);
      if (i >= 0) {
        fromSlot = s;
        fromIndex = i;
        found = true;
      }
    }
    if (!found) return prev;
  }
  slots[fromSlot]!.items.splice(fromIndex, 1);
  const target = slots[toSlot];
  if (!target) return prev;
  target.items.splice(Math.min(toIndex, target.items.length), 0, id);
  return { ...prev, slots };
}

/** DnD 载荷序列化（text/kami-desk）：坏载荷回 null，drop 不生效。 */
function deskDragToString(d: DeskDrag): string {
  return JSON.stringify(d);
}

function deskDragFromString(raw: string | null): DeskDrag | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as DeskDrag;
    if (typeof d?.moduleId !== "string" || typeof d?.fromSlot !== "number" || typeof d?.fromIndex !== "number") return null;
    return d;
  } catch {
    return null;
  }
}

export function DeskPage() {
  const watchArtists = useSettings((s) => s.watchArtists);
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const tab = useSettings((s) => s.tab);
  const deskPresets = useSettings((s) => s.deskPresets);
  const activeDeskPresetId = useSettings((s) => s.activeDeskPresetId);
  const hydrated = useSettingsHydrated();
  const navigate = useNavigate();
  const historyItems = useViewHistory((s) => s.items);
  const [vault, setVault] = useState<VaultMeta[]>([]);
  const [vaultReady, setVaultReady] = useState(false);
  const { title, date } = todayLabel();

  // ── 编辑态（draft 只在编辑期间存在；完成/存为才落 store） ──
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DeskLayout>(DEFAULT_DESK_LAYOUT);
  const [selected, setSelected] = useState<DeskModuleId | null>(null);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [dropSlot, setDropSlot] = useState<number | null>(null);

  // 案头是 Pixiv 专属：FANBOX / 三图站没有案头，水合后直达浏览
  // （水合前不知 tab，先按服务端形态画，避免闪空屏）
  useEffect(() => {
    if (hydrated && tab !== "pixiv") void navigate({ to: "/browse" });
  }, [hydrated, tab, navigate]);

  // ?edit=1 深链：挂载读一次（不用 useSearchParams——那会逼页级 Suspense），
  // 读完立刻从地址摘掉，编辑态只在 React 里。
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("edit") === "1") {
      const p = useSettings.getState().deskPresets.find(
        (item) => item.id === useSettings.getState().activeDeskPresetId,
      );
      setDraft(p?.layout ?? DEFAULT_DESK_LAYOUT);
      setEditing(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  // 编辑态挂属性：styles.css 借此关掉模块内部交互（pointer-events-none）等。
  useEffect(() => {
    if (editing) document.documentElement.setAttribute("data-desk-edit", "1");
    else document.documentElement.removeAttribute("data-desk-edit");
    return () => document.documentElement.removeAttribute("data-desk-edit");
  }, [editing]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let local: VaultMeta[] = [];
      try {
        local = await listVault();
      } catch {
        local = [];
      }
      let remote: Awaited<ReturnType<typeof listServerVault>> | null = null;
      try {
        remote = await listServerVault();
      } catch {
        remote = null;
      }
      if (cancelled) return;
      const remoteItems = remote?.items ?? [];
      if (remoteItems.length > 0) {
        setVault(mergeVaultItems(local, remoteItems));
      } else {
        setVault(local);
      }
      setVaultReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const unread = useMemo(
    () => (vaultReady ? unreadItems(vault, historyItems) : []),
    [vaultReady, vault, historyItems],
  );
  const unreadCount = unread.length;
  const slipLine = useMemo(() => {
    if (!vaultReady) return null;
    const now = Date.now();
    return onThisDaySlipLine(onThisDay(vault, now), now);
  }, [vaultReady, vault]);

  // 模块可用性（案头级判，模块内部不再重复）：信=有追踪、纸叠=有未读、
  // 墙=Pixiv 已登录；铺纸/报纸恒可用。渲染期据此让空槽让位。
  const pixivLoggedIn = hydrated && pixivCookie.trim() !== "";
  const available = useMemo<Set<DeskModuleId>>(() => {
    const set = new Set<DeskModuleId>(["browse-sheet", "newspaper"]);
    if (watchArtists.length > 0) set.add("letters");
    if (unreadCount > 0) set.add("stack");
    if (pixivLoggedIn) set.add("artist-wall");
    return set;
  }, [watchArtists.length, unreadCount, pixivLoggedIn]);

  // 激活版式 → 槽编排（数据坏了 parse 已兜底；此处再做空槽让位投影）。
  // 两层合并（P2）：激活主题包带布局且开「跟随」→ 包布局上位；用户编辑保存
  // 时自动关跟随——自己摆的纸不该被换个主题冲掉。
  const activePreset = deskPresets.find((p) => p.id === activeDeskPresetId) ?? deskPresets[0];
  const userLayout = activePreset?.layout ?? DEFAULT_DESK_LAYOUT;
  const { pack: activeThemePack } = useActiveThemePack();
  const followThemeLayout = useSettings((s) => s.themePack.followLayout);
  const layout =
    activeThemePack?.manifest.layout && followThemeLayout ? activeThemePack.manifest.layout : userLayout;
  const slots = useMemo(() => reflowDeskLayout(layout.slots, available), [layout, available]);
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(layout);

  // 未保存离开兜底：刷新/关标签走 beforeunload；SPA 内路由跳转（侧栏/页眉
  // 链接）在捕获阶段拦 click 确认——Next App Router 没有路由阻塞 API。
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (!window.confirm("编排还没保存，离开会丢弃改动。确定离开？")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", guard);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  // ── 编辑动作 ──
  const enterEdit = () => {
    setDraft(layout);
    setSelected(null);
    setEditing(true);
  };
  const exitEdit = () => {
    setEditing(false);
    setSelected(null);
  };
  const removeFromDraft = (id: DeskModuleId) =>
    setDraft((prev) => ({
      ...prev,
      slots: prev.slots.map((s) => ({ ...s, items: s.items.filter((m) => m !== id) })),
    }));
  const handleDrop = (e: DragEvent, slotIndex: number) => {
    e.preventDefault();
    setDropSlot(null);
    const d: DeskDrag | null = deskDragFromString(e.dataTransfer.getData("text/kami-desk"));
    if (!d) return;
    const toIndex = draft.slots[slotIndex]?.items.length ?? 0;
    setDraft((prev) => moveModuleInDraft(prev, d.moduleId, d.fromSlot, d.fromIndex, slotIndex, toIndex));
  };
  const onDone = () => {
    if (!dirty) {
      exitEdit();
      return;
    }
    // 内置稿纸不可写：改过就得存为版式（对话框接管）；用户版式直接写回。
    // 主题包「跟随布局」的让位已内置在 setDeskLayout / saveDeskPreset（微调即接管）。
    if (activePreset?.builtIn) {
      setSaveAsOpen(true);
      return;
    }
    useSettings.getState().setDeskLayout(draft);
    exitEdit();
  };
  const onSaveAsSubmit = (name: string) => {
    const id = useSettings.getState().saveDeskPreset(name, draft);
    if (!id) {
      toast.error("版式已满 12 套，先在设置→外观删掉一个再存", { id: "kami-desk-preset-full" });
      return;
    }
    setSaveAsOpen(false);
    exitEdit();
  };

  // 键盘兜底：选中模块后 ←→ 跨槽、↑↓ 槽内换序、Delete 下场。
  // 命名对话框开着 / 焦点在输入框时不抢键（否则 Backspace 会把模块下场）。
  useEffect(() => {
    if (!editing || !selected || saveAsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      let fromSlot = -1;
      let fromIndex = -1;
      draft.slots.forEach((s, si) => {
        const i = s.items.indexOf(selected);
        if (i >= 0) {
          fromSlot = si;
          fromIndex = i;
        }
      });
      if (fromSlot < 0) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const toSlot = Math.min(Math.max(fromSlot + (e.key === "ArrowLeft" ? -1 : 1), 0), draft.slots.length - 1);
        if (toSlot !== fromSlot) {
          setDraft((prev) => moveModuleInDraft(prev, selected, fromSlot, fromIndex, toSlot, prev.slots[toSlot]?.items.length ?? 0));
        }
      } else if (e.key === "ArrowUp" && fromIndex > 0) {
        e.preventDefault();
        setDraft((prev) => moveModuleInDraft(prev, selected, fromSlot, fromIndex, fromSlot, fromIndex - 1));
      } else if (e.key === "ArrowDown" && fromIndex < (draft.slots[fromSlot]?.items.length ?? 0) - 1) {
        e.preventDefault();
        setDraft((prev) => moveModuleInDraft(prev, selected, fromSlot, fromIndex, fromSlot, fromIndex + 1));
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeFromDraft(selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, selected, draft, saveAsOpen]);

  const tray = useMemo(() => {
    const inDraft = new Set(draft.slots.flatMap((s) => s.items));
    return DESK_MODULE_IDS.filter((id) => !inDraft.has(id));
  }, [draft]);

  // 已水合且非 Pixiv：案头不亮相，重定向期间画 null（不闪内容）
  if (hydrated && tab !== "pixiv") return null;

  return (
    <div className="kami-content mx-0 max-w-6xl space-y-4 2xl:max-w-[90rem]">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-3">
        <h1 className="font-display text-3xl tracking-tight md:text-4xl">{title}</h1>
        <p className="text-sm text-muted">{date}</p>
        <div className="ml-auto flex items-center gap-2">
          {slipLine && (editing ? draft.headerSlip : layout.headerSlip) ? (
            <Link to="/vault?recall=1" className="kami-slip">
              {slipLine}
            </Link>
          ) : null}
          {editing ? null : (
            <Button type="button" size="sm" variant="ghost" className="hidden lg:inline-flex" onClick={enterEdit}>
              编排
            </Button>
          )}
        </div>
      </header>

      {editing ? (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {draft.slots.map((slot, si) => (
              <DeskEditSlot
                key={si}
                slot={slot}
                index={si}
                dropping={dropSlot === si}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropSlot(si);
                }}
                onDragLeave={() => setDropSlot((cur) => (cur === si ? null : cur))}
                onDrop={handleDrop}
                onSpan={(slotIndex, span) =>
                  setDraft((prev) => ({
                    ...prev,
                    slots: prev.slots.map((s, i) => (i === slotIndex ? { ...s, span } : s)),
                  }))
                }
              >
                {slot.items.map((id, ii) => {
                  const Node = DESK_MODULE_NODES[id];
                  return (
                    <DeskEditCard
                      key={id}
                      moduleId={id}
                      selected={selected === id}
                      onSelect={() => setSelected((cur) => (cur === id ? null : id))}
                      onRemove={() => removeFromDraft(id)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/kami-desk", deskDragToString({ moduleId: id, fromSlot: si, fromIndex: ii }));
                        e.dataTransfer.effectAllowed = "move";
                        setSelected(id);
                      }}
                      onDragEnd={() => setDropSlot(null)}
                    >
                      {Node ? Node({ unread, unreadCount }) : null}
                    </DeskEditCard>
                  );
                })}
              </DeskEditSlot>
            ))}
          </div>
          <DeskEditBar
            presets={deskPresets}
            activePresetId={activePreset?.id ?? DESK_DEFAULT_PRESET_ID}
            dirty={dirty}
            tray={tray}
            headerSlip={draft.headerSlip}
            onPickPreset={(id) => {
              if (dirty && !window.confirm("当前摆法还没保存，切换版式会丢弃改动。确定切换？")) return;
              useSettings.getState().activateDeskPreset(id);
              const p = useSettings.getState().deskPresets.find((item) => item.id === id);
              setDraft(p?.layout ?? DEFAULT_DESK_LAYOUT);
              setSelected(null);
            }}
            onToggleHeaderSlip={() => setDraft((prev) => ({ ...prev, headerSlip: !prev.headerSlip }))}
            onTrayAdd={(id) =>
              setDraft((prev) => ({
                ...prev,
                slots: prev.slots.map((s, i) =>
                  i === prev.slots.length - 1 ? { ...s, items: [...s.items, id] } : s,
                ),
              }))
            }
            onAddSlot={() => setDraft((prev) => ({ ...prev, slots: [...prev.slots, { span: 1, items: [] }] }))}
            onSaveAs={() => setSaveAsOpen(true)}
            onReset={() => {
              useSettings.getState().activateDeskPreset(DESK_DEFAULT_PRESET_ID);
              setDraft(DEFAULT_DESK_LAYOUT);
              setSelected(null);
            }}
            onDone={onDone}
          />
          <DeskSaveAsDialog open={saveAsOpen} onCancel={() => setSaveAsOpen(false)} onSubmit={onSaveAsSubmit} />
        </>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {slots.map((slot, i) => (
            <div key={i} data-desk-slot={i} className={cn("flex flex-col gap-4", SPAN_CLASS[slot.span])}>
              {slot.items.map((id) => {
                const Node = DESK_MODULE_NODES[id];
                return Node ? (
                  <div key={id} data-desk-module={id}>
                    {Node({ unread, unreadCount })}
                  </div>
                ) : null;
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
