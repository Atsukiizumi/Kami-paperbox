/**
 * 设置「外观」页 + 顶栏主题菜单。
 *
 * 作用：ThemeSection 是设置外观分区的主题选择卡片；ThemeMenu 是顶栏的主题下拉。
 * 用法：设置页按分区渲染 ThemeSection；AppShell 挂 ThemeMenu。
 * 为什么：切换用 View Transition 从点击点圆形揭示（动效批 B），两处共用一套过渡。
 */
import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  THEME_LIST,
  type Appearance,
  type ThemeId,
  themeTokens,
} from "@/lib/theme";
import { flushSync } from "react-dom";
import { useSettings } from "@/lib/store";
import { EASE_OUT } from "@/lib/motion";
import { canAnimateUi, playOwnedMotion } from "@/lib/motion-runtime";
import { themeAssetUrl, useThemePackList } from "@/lib/theme-pack-client";
import { composeExportManifest, type ThemePackInfo } from "@/lib/theme-pack";
import { DEFAULT_DESK_LAYOUT, DEFAULT_SHELL_CUSTOM, SHELL_WIDTH_RANGE } from "@/lib/desk-layout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** 主题切换圆形揭示（动效批 B）：View Transition 从点击点扩散；不支持的浏览器或动效关闭时直接切。
 *  圆形扩撒的关键帧动画交给 motion-runtime 托管——等待 ready 期间开关可能被关掉，托管后统一收尾。 */
function transitionTheme(apply: () => void, point?: { x: number; y: number }) {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> };
  };
  if (!doc.startViewTransition || !useSettings.getState().motionEnabled) {
    apply();
    return;
  }
  const transition = doc.startViewTransition(() => {
    flushSync(apply);
  });
  if (!point) return;
  document.documentElement.setAttribute("data-theme-transitioning", "");
  void transition.ready
    .then(() => {
      if (!canAnimateUi(document.documentElement)) return;
      const radius = Math.hypot(
        Math.max(point.x, window.innerWidth - point.x),
        Math.max(point.y, window.innerHeight - point.y),
      );
      playOwnedMotion(
        document.documentElement,
        [
          { clipPath: `circle(0px at ${point.x}px ${point.y}px)` },
          { clipPath: `circle(${radius}px at ${point.x}px ${point.y}px)` },
        ],
        { duration: 420, easing: EASE_OUT, pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => undefined)
    .finally(() => {
      // ready / finished 在 View Transition 被跳过时会 reject，两处都吞掉再摘标记
      void transition.finished
        .catch(() => undefined)
        .then(() => document.documentElement.removeAttribute("data-theme-transitioning"));
    });
}
import { cn } from "@/lib/utils";
import { useResolvedAppearance } from "@/components/theme-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const APPEARANCE_OPTIONS: { id: Appearance; label: string; icon: typeof Sun }[] = [
  { id: "system", label: "跟随系统", icon: Monitor },
  { id: "light", label: "浅色", icon: Sun },
  { id: "dark", label: "深色", icon: Moon },
];

function AppearanceToggle() {
  const appearance = useSettings((s) => s.appearance);
  const setAppearance = useSettings((s) => s.setAppearance);
  const activeIndex = Math.max(
    0,
    APPEARANCE_OPTIONS.findIndex((option) => option.id === appearance),
  );

  return (
    <div
      className="relative grid grid-cols-3 rounded-xl bg-bg p-1"
      role="radiogroup"
      aria-label="浅色或深色"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute top-1 left-0 flex h-10 w-1/3 justify-center px-1 transition-transform duration-200 ease-out"
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
      >
        <span className="h-full w-full rounded-lg bg-elevated" />
      </span>
      {APPEARANCE_OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = appearance === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setAppearance(option.id)}
            className={cn(
              "relative z-10 inline-flex h-10 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors duration-200",
              active ? "text-fg" : "text-muted hover:text-fg",
            )}
          >
            <Icon className="size-3.5" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SwatchPreview({ id }: { id: ThemeId }) {
  return (
    <span className="grid grid-cols-2 overflow-hidden rounded-lg">
      {(["dark", "light"] as const).map((mode) => {
        const tokens = themeTokens(id, mode);
        return (
          <span key={mode} className="flex h-14 flex-col" style={{ background: tokens.bg }}>
            <span className="block h-2" style={{ background: tokens.surface }} />
            <span className="mt-auto mb-2 ml-2 block h-4 w-8 rounded-sm" style={{ background: tokens.accent }} />
          </span>
        );
      })}
    </span>
  );
}

function ThemeSwatches() {
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {THEME_LIST.map((def) => {
        const active = theme === def.id;
        return (
          <button
            key={def.id}
            type="button"
            onClick={(e) => transitionTheme(() => setTheme(def.id), { x: e.clientX, y: e.clientY })}
            aria-pressed={active}
            className={cn(
              "rounded-xl p-2 text-left transition-colors duration-200",
              active ? "bg-elevated ring-1 ring-accent" : "bg-bg hover:bg-elevated/70",
            )}
          >
            <SwatchPreview id={def.id} />
            <span className="mt-2 flex items-center justify-between gap-2 px-0.5">
              <span>
                <span className="block text-sm font-medium text-fg">{def.name}</span>
                <span className="block text-xs text-muted">{def.description}</span>
              </span>
              {active ? <Check className="kami-pop size-4 shrink-0 text-accent" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 界面风格（纸感质感批 PR2）：利落（默认）↔ 手绘记号层，切换即时生效。 */
function StyleToggle() {
  const uiStyle = useSettings((s) => s.uiStyle);
  const setUiStyle = useSettings((s) => s.setUiStyle);
  const options = [
    { id: "clean", name: "利落", description: "直角规整，默认形态" },
    { id: "hand", name: "手绘", description: "手写标题、笺条微歪、墨晕" },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((opt) => {
        const active = uiStyle === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => setUiStyle(opt.id)}
            aria-pressed={active}
            className={cn(
              "rounded-xl p-3 text-left transition-colors duration-200",
              active ? "bg-elevated ring-1 ring-accent" : "bg-bg hover:bg-elevated/70",
            )}
          >
            <span className={cn("text-sm font-medium text-fg", opt.id === "hand" && "font-display")}>
              {opt.name}
            </span>
            <span className="mt-0.5 block text-xs text-muted">{opt.description}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 动效总开关：应用内动效（轮播流动 / 翻牌 / 滚动渐入 / 主题揭示）的内置开关，不跟随系统「减弱动态效果」。 */
function MotionToggle() {
  const motionEnabled = useSettings((s) => s.motionEnabled);
  const setMotionEnabled = useSettings((s) => s.setMotionEnabled);

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-bg p-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">动画效果</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted">
          轮播流动、翻牌、滚动渐入等应用内动效的总开关；不跟随系统的「减弱动态效果」。
        </span>
      </span>
      <Switch checked={motionEnabled} onCheckedChange={setMotionEnabled} aria-label="动画效果" />
    </div>
  );
}

/** 小段选器（外壳旋钮用）：label + 一排互斥按钮。 */
function Segmented({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: readonly { v: string; t: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-bg p-3">
      <span className="text-sm text-fg">{label}</span>
      <div className="flex shrink-0 rounded-lg bg-surface p-0.5">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            aria-pressed={value === o.v}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs transition-colors duration-200",
              value === o.v ? "bg-elevated text-fg" : "text-muted hover:text-fg",
            )}
          >
            {o.t}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 外壳形态（布局引擎 P1）：书案（现状）↔ 窄脊图标条 ↔ 无框浮钮；旋钮按形态白名单开放。 */
function ShellSection() {
  const shell = useSettings((s) => s.shell);
  const setShellForm = useSettings((s) => s.setShellForm);
  const setShellTweak = useSettings((s) => s.setShellTweak);
  const forms = [
    { id: "desk", name: "书案", description: "全字侧栏 + 顶栏，默认形态" },
    { id: "rail", name: "窄脊", description: "图标条侧栏，内容更宽" },
    { id: "zen", name: "无框", description: "导航收进浮钮，满宽沉浸" },
    { id: "custom", name: "自定义", description: "侧栏/顶栏/宽度自由组合" },
  ] as const;

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {forms.map((opt) => {
          const active = shell.form === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setShellForm(opt.id)}
              aria-pressed={active}
              className={cn(
                "rounded-xl p-3 text-left transition-colors duration-200",
                active ? "bg-elevated ring-1 ring-accent" : "bg-bg hover:bg-elevated/70",
              )}
            >
              <span className="block text-sm font-medium text-fg">{opt.name}</span>
              <span className="mt-0.5 block text-xs leading-snug text-muted">{opt.description}</span>
            </button>
          );
        })}
      </div>
      {shell.form === "desk" ? (
        <>
          <Segmented
            label="内容宽度"
            value={shell.tweaks.contentWidth ?? "paper"}
            options={[{ v: "paper", t: "纸宽" }, { v: "wide", t: "宽" }, { v: "full", t: "满" }]}
            onChange={(v) => setShellTweak({ contentWidth: v as "paper" | "wide" | "full" })}
          />
          <Segmented
            label="顶栏密度"
            value={shell.tweaks.topbarDensity ?? "normal"}
            options={[{ v: "normal", t: "常规" }, { v: "compact", t: "紧凑" }]}
            onChange={(v) => setShellTweak({ topbarDensity: v as "normal" | "compact" })}
          />
        </>
      ) : null}
      {shell.form === "rail" ? (
        <>
          <Segmented
            label="内容宽度"
            value={shell.tweaks.contentWidth ?? "paper"}
            options={[{ v: "paper", t: "纸宽" }, { v: "wide", t: "宽" }, { v: "full", t: "满" }]}
            onChange={(v) => setShellTweak({ contentWidth: v as "paper" | "wide" | "full" })}
          />
          <Segmented
            label="图标大小"
            value={shell.tweaks.iconSize ?? "md"}
            options={[{ v: "sm", t: "小" }, { v: "md", t: "中" }, { v: "lg", t: "大" }]}
            onChange={(v) => setShellTweak({ iconSize: v as "sm" | "md" | "lg" })}
          />
          <Segmented
            label="顶栏"
            value={shell.tweaks.topbar ?? "on"}
            options={[{ v: "on", t: "常驻" }, { v: "float", t: "浮胶囊" }]}
            onChange={(v) => setShellTweak({ topbar: v as "on" | "float" })}
          />
        </>
      ) : null}
      {shell.form === "zen" ? (
        <>
          <Segmented
            label="内容边距"
            value={shell.tweaks.contentMargin ?? "normal"}
            options={[{ v: "normal", t: "标准" }, { v: "tight", t: "贴边" }]}
            onChange={(v) => setShellTweak({ contentMargin: v as "normal" | "tight" })}
          />
          <Segmented
            label="浮钮位置"
            value={shell.tweaks.triggerSide ?? "left"}
            options={[{ v: "left", t: "左下" }, { v: "right", t: "右下" }]}
            onChange={(v) => setShellTweak({ triggerSide: v as "left" | "right" })}
          />
        </>
      ) : null}
      {shell.form === "custom" ? <ShellCustomPanel /> : null}
    </>
  );
}

/** custom 形态参数面板（P3）：侧栏形态/宽度/位置 + 顶栏 + 内容宽，改即生效。 */
function ShellCustomPanel() {
  const shell = useSettings((s) => s.shell);
  const setShellCustom = useSettings((s) => s.setShellCustom);
  const c = shell.custom ?? DEFAULT_SHELL_CUSTOM;
  const [min, max] = SHELL_WIDTH_RANGE[c.sidebar.mode === "icons" ? "icons" : "full"];

  return (
    <>
      <div className="flex items-center justify-between gap-4 rounded-xl bg-bg p-3">
        <span className="text-sm text-fg">侧栏形态</span>
        <div className="flex shrink-0 rounded-lg bg-surface p-0.5">
          {([["full", "全字"], ["icons", "图标"], ["hidden", "隐藏"]] as const).map(([v, t]) => (
            <button
              key={v}
              type="button"
              aria-pressed={c.sidebar.mode === v}
              onClick={() => setShellCustom({ sidebar: { mode: v, side: c.sidebar.side, width: v === "hidden" ? 0 : c.sidebar.width || (v === "icons" ? 64 : 224) } })}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition-colors duration-200",
                c.sidebar.mode === v ? "bg-elevated text-fg" : "text-muted hover:text-fg",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      {c.sidebar.mode === "hidden" ? null : (
        <div className="flex items-center justify-between gap-4 rounded-xl bg-bg p-3">
          <span className="text-sm text-fg">
            侧栏宽度<span className="ml-1.5 text-xs tabular-nums text-muted">{c.sidebar.width}px</span>
          </span>
          <input
            type="range"
            min={min}
            max={max}
            step={4}
            value={c.sidebar.width}
            aria-label="侧栏宽度"
            onChange={(e) => setShellCustom({ sidebar: { mode: c.sidebar.mode, side: c.sidebar.side, width: Number(e.target.value) } })}
            className="h-1.5 w-40 shrink-0 cursor-pointer appearance-none rounded-full bg-surface accent-[var(--color-accent)]"
          />
        </div>
      )}
      <Segmented
        label="侧栏位置"
        value={c.sidebar.side}
        options={[{ v: "left", t: "左侧" }, { v: "right", t: "右侧" }]}
        onChange={(v) => setShellCustom({ sidebar: { mode: c.sidebar.mode, side: v as "left" | "right", width: c.sidebar.width } })}
      />
      <div className="flex items-center justify-between gap-4 rounded-xl bg-bg p-3">
        <span className="text-sm text-fg">顶栏</span>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex rounded-lg bg-surface p-0.5">
            {([["normal", "常规"], ["compact", "紧凑"]] as const).map(([v, t]) => (
              <button
                key={v}
                type="button"
                aria-pressed={c.topbar.density === v}
                onClick={() => setShellCustom({ topbar: { visible: c.topbar.visible, density: v } })}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs transition-colors duration-200",
                  c.topbar.density === v ? "bg-elevated text-fg" : "text-muted hover:text-fg",
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <Switch checked={c.topbar.visible} onCheckedChange={(v) => setShellCustom({ topbar: { visible: v, density: c.topbar.density } })} aria-label="顶栏显示" />
        </div>
      </div>
      <Segmented
        label="内容宽度"
        value={c.content.width}
        options={[{ v: "paper", t: "纸宽" }, { v: "wide", t: "宽" }, { v: "full", t: "满" }]}
        onChange={(v) => setShellCustom({ content: { width: v as "paper" | "wide" | "full" } })}
      />
    </>
  );
}

/** 案头版式行（布局引擎 P1）：切换激活版式；用户版式可删，内置稿纸不可删。 */
function DeskPresetRow() {
  const deskPresets = useSettings((s) => s.deskPresets);
  const activeDeskPresetId = useSettings((s) => s.activeDeskPresetId);
  const activateDeskPreset = useSettings((s) => s.activateDeskPreset);
  const removeDeskPreset = useSettings((s) => s.removeDeskPreset);

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-bg p-3">
      {deskPresets.map((p) => {
        const active = p.id === activeDeskPresetId;
        return (
          <span key={p.id} className="relative">
            <button
              type="button"
              onClick={() => activateDeskPreset(p.id)}
              aria-pressed={active}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                active ? "bg-elevated text-fg ring-1 ring-accent" : "text-muted hover:text-fg",
              )}
            >
              {p.name}
            </button>
            {p.builtIn ? null : (
              <button
                type="button"
                aria-label={`删除版式${p.name}`}
                onClick={() => removeDeskPreset(p.id)}
                className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full border border-border bg-bg text-[10px] leading-none text-muted transition-colors hover:text-fg"
              >
                ×
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** 各页版式参数（布局引擎 P1）：浏览密度 / 纸匣列宽；medium = 现状。 */
function PageLayoutSection() {
  const pageLayout = useSettings((s) => s.pageLayout);
  const setPageLayout = useSettings((s) => s.setPageLayout);

  return (
    <>
      <Segmented
        label="浏览卡片密度"
        value={pageLayout.density}
        options={[{ v: "loose", t: "松" }, { v: "medium", t: "中" }, { v: "tight", t: "紧" }]}
        onChange={(v) => setPageLayout({ density: v as "loose" | "medium" | "tight" })}
      />
      <Segmented
        label="纸匣瀑布列宽"
        value={pageLayout.vaultCol}
        options={[{ v: "narrow", t: "窄" }, { v: "medium", t: "中" }, { v: "wide", t: "宽" }]}
        onChange={(v) => setPageLayout({ vaultCol: v as "narrow" | "medium" | "wide" })}
      />
    </>
  );
}

/** 主题包管理（P2）：列表启停 / 跟随开关 / 导出当前 / 打开文件夹 / 重新扫描。 */
function ThemePackSection() {
  const queryClient = useQueryClient();
  const query = useThemePackList();
  const list = query.data;
  const loading = query.isPending;
  const themePack = useSettings((s) => s.themePack);
  const setThemePackActive = useSettings((s) => s.setThemePackActive);
  const setThemePackFollow = useSettings((s) => s.setThemePackFollow);
  const [exporting, setExporting] = useState(false);
  const [exportName, setExportName] = useState("");

  const refresh = async (rescan: boolean) => {
    // 强扫走 POST op:rescan（要会话）——GET 已不带 ?rescan=1（guest 触发面归零）
    if (rescan) {
      await fetch("/api/themes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "rescan" }),
      }).catch(() => undefined);
    }
    await queryClient.invalidateQueries({ queryKey: ["theme-packs"] });
  };

  const themes = list?.themes ?? [];
  const activePack = themes.find((t) => t.id === themePack.activeId) ?? null;

  const exportCurrent = async () => {
    const s = useSettings.getState();
    const activePreset = s.deskPresets.find((p) => p.id === s.activeDeskPresetId);
    // 导出保真（④）：按 effective 组装——激活包的 palette 恒随包；shell/layout 按
    // 跟随旗取包值（R4 后用户改过即关跟随，剩下的就是所见）；css/assets 的声明
    // 与文件本体由服务端按 from 克隆。
    const pack = activePack;
    const palette = pack?.manifest.palette ?? { base: s.theme };
    const shell =
      pack && s.themePack.followShell && pack.manifest.shell ? pack.manifest.shell : s.shell;
    const layout =
      pack && s.themePack.followLayout && pack.manifest.layout
        ? pack.manifest.layout
        : (activePreset?.layout ?? DEFAULT_DESK_LAYOUT);
    const manifest = composeExportManifest({
      name: exportName,
      theme: palette.base ?? s.theme,
      shell,
      layout,
    });
    // 来源包的 overrides/css/assets 声明带上（css/assets 声明 + from 让服务端克隆文件）
    if (pack) {
      if (palette.overrides) manifest.palette = { ...manifest.palette, overrides: palette.overrides };
      if (pack.manifest.css && pack.css !== null) manifest.css = pack.manifest.css;
      if (pack.manifest.assets?.length) manifest.assets = pack.manifest.assets;
    }
    setExporting(false);
    const res = await fetch("/api/themes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "export", manifest, from: pack?.id }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(`导出失败：${data.error ?? res.status}`);
      return;
    }
    await refresh(true);
    toast.success("已导出为主题包，列表里可以启用它");
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => setExporting(true)}>
          导出当前为主题包
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() =>
            void fetch("/api/themes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "openDir" }) }).then((res) => {
              if (!res.ok) toast.error("主题文件夹打开失败（需要登录）", { id: "kami-themes-opendir" });
            })
          }
        >
          打开主题文件夹
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => void refresh(true)}>
          重新扫描
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted">正在读主题文件夹…</p>
      ) : query.isError ? (
        <p className="text-sm text-muted">主题文件夹读取失败——「重新扫描」再试一次。</p>
      ) : themes.length === 0 ? (
        <div className="rounded-xl bg-bg p-4 text-sm leading-relaxed text-muted">
          还没有主题包。点「打开主题文件夹」，把别人分享的包（整个文件夹或 zip）丢进去；
          里面的 <span className="text-fg">_template</span> 是样板，照着改就是你的第一个主题。
        </div>
      ) : (
        <ul className="space-y-2">
          {themes.map((pack) => (
            <ThemePackRow
              key={pack.id}
              pack={pack}
              active={pack.id === themePack.activeId}
              onToggle={() => {
                setThemePackActive(pack.id === themePack.activeId ? null : pack.id);
              }}
            />
          ))}
          {list && list.overLimit > 0 ? (
            <li className="text-xs text-subtle">还有 {list.overLimit} 个包超出 50 上限未显示</li>
          ) : null}
        </ul>
      )}

      {activePack ? (
        <div className="space-y-2 rounded-xl bg-bg p-3">
          <p className="text-xs text-subtle">「{activePack.name}」生效中——以下开关决定它管多少：</p>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-fg">配色与 CSS</span>
            <span className="text-xs text-muted">随包生效</span>
          </div>
          <FollowSwitch
            label="外壳形态"
            checked={themePack.followShell}
            onChange={(v) => setThemePackFollow({ followShell: v })}
          />
          <FollowSwitch
            label="案头布局"
            checked={themePack.followLayout}
            onChange={(v) => setThemePackFollow({ followLayout: v })}
          />
        </div>
      ) : null}

      <Dialog open={exporting} onOpenChange={(v) => (v ? undefined : setExporting(false))}>
        <DialogContent className="w-[min(92vw,22rem)]">
          <DialogTitle>导出当前为主题包</DialogTitle>
          <DialogDescription>
            把现在的配色、外壳、案头摆法打包成主题文件夹，放进 themes/ 可启用可分享。
          </DialogDescription>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (exportName.trim()) void exportCurrent();
            }}
          >
            <Input value={exportName} onChange={(e) => setExportName(e.target.value)} placeholder="比如：夜读" maxLength={24} autoFocus />
            <Button type="submit" size="sm" disabled={!exportName.trim()}>
              导出
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FollowSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-fg">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={`主题跟随·${label}`} />
    </div>
  );
}

function ThemePackRow({ pack, active, onToggle }: { pack: ThemePackInfo; active: boolean; onToggle: () => void }) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-xl p-2.5",
        active ? "bg-elevated ring-1 ring-accent" : "bg-bg",
      )}
    >
      <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface">
        {pack.manifest.preview ? (
          <img
            src={themeAssetUrl(pack.id, pack.manifest.preview)}
            alt=""
            className="size-full object-cover"
          />
        ) : (
          <span className="font-display text-lg text-subtle">{pack.name.slice(0, 1)}</span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-fg">{pack.name}</span>
          {pack.status === "degraded" ? (
            <span
              className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted"
              title={pack.dropped.join("；")}
            >
              部分生效
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted">
          {[pack.author, pack.version, pack.hasCss ? "带 CSS" : null].filter(Boolean).join(" · ") || pack.id}
        </span>
      </span>
      <Button type="button" size="sm" variant={active ? "default" : "secondary"} aria-pressed={active} onClick={onToggle}>
        {active ? "停用" : "启用"}
      </Button>
    </li>
  );
}

export function ThemeSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>外观</CardTitle>
        <CardDescription>浅色和深色各有一套配色。跟随系统会跟着设备自动切换。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <AppearanceToggle />
        <div>
          <h2 className="text-sm font-medium">界面风格</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            手绘风在纸面上做记号：标题换手写字、笺条微歪、悬停有墨晕。控件形态两种风格一致。
          </p>
        </div>
        <StyleToggle />
        <div>
          <h2 className="text-sm font-medium">动效</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            应用内动效由纸匣自己的开关控制，与系统的动画设置互不影响。
          </p>
        </div>
        <MotionToggle />
        <div>
          <h2 className="text-sm font-medium">外壳</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            应用框架的形态：书案 / 窄脊 / 无框。仅桌面端生效，手机保持原样。
          </p>
        </div>
        <ShellSection />
        <div>
          <h2 className="text-sm font-medium">版式</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            案头摆法在这几套版式间切换（细摆去案头点「编排」）；下面是各页的铺法参数，中档是默认值。
          </p>
        </div>
        <DeskPresetRow />
        <PageLayoutSection />
        <div>
          <h2 className="text-sm font-medium">主题</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            五套纸匣配色，浏览区和按钮都会跟着换。
          </p>
        </div>
        <ThemeSwatches />
        <div>
          <h2 className="text-sm font-medium">主题包</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            把别人分享的主题（整个文件夹或 zip）丢进 themes/ 文件夹即可选用；_template
            是样板，里面的 agent-prompt.md 可以交给任意 AI 替你做一个。停用即回到上面的内置观感。
          </p>
        </div>
        <ThemePackSection />
      </CardContent>
    </Card>
  );
}

function ThemeDot({ id }: { id: ThemeId }) {
  const resolved = useResolvedAppearance();
  const tokens = themeTokens(id, resolved);
  return (
    <span
      className="size-3.5 shrink-0 rounded-full ring-1 ring-border"
      style={{ background: tokens.accent }}
      aria-hidden
    />
  );
}

export function ThemeMenu() {
  const theme = useSettings((s) => s.theme);
  const appearance = useSettings((s) => s.appearance);
  const setTheme = useSettings((s) => s.setTheme);
  const setAppearance = useSettings((s) => s.setAppearance);
  const current = THEME_LIST.find((item) => item.id === theme) ?? THEME_LIST[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-fg"
          aria-label={`主题：${current.name}`}
        >
          <Palette className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>外观</DropdownMenuLabel>
        {APPEARANCE_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <DropdownMenuItem key={option.id} onSelect={() => setAppearance(option.id)}>
              {appearance === option.id ? (
                <Check className="size-4 text-accent" />
              ) : (
                <span className="size-4" />
              )}
              <Icon className="size-4" />
              {option.label}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>主题</DropdownMenuLabel>
        {THEME_LIST.map((def) => (
          <DropdownMenuItem key={def.id} onSelect={() => transitionTheme(() => setTheme(def.id))}>
            {theme === def.id ? (
              <Check className="size-4 text-accent" />
            ) : (
              <span className="size-4" />
            )}
            <ThemeDot id={def.id} />
            <span className="flex min-w-0 flex-col">
              <span>{def.name}</span>
              <span className="text-xs text-subtle">{def.description}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
