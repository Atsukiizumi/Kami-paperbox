/**
 * 设置「外观」页 + 顶栏主题菜单。
 *
 * 作用：ThemeSection 是设置外观分区的主题选择卡片；ThemeMenu 是顶栏的主题下拉。
 * 用法：设置页按分区渲染 ThemeSection；AppShell 挂 ThemeMenu。
 * 为什么：切换用 View Transition 从点击点圆形揭示（动效批 B），两处共用一套过渡。
 */
import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import {
  THEME_LIST,
  type Appearance,
  type ThemeId,
  themeTokens,
} from "@/lib/theme";
import { flushSync } from "react-dom";
import { useSettings } from "@/lib/store";

/** 主题切换圆形揭示（动效批 B）：View Transition 从点击点扩散；不支持的浏览器或动效关闭时直接切。 */
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
  void transition.ready.then(() => {
    const radius = Math.hypot(
      Math.max(point.x, window.innerWidth - point.x),
      Math.max(point.y, window.innerHeight - point.y),
    );
    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${point.x}px ${point.y}px)`,
          `circle(${radius}px at ${point.x}px ${point.y}px)`,
        ],
      },
      { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
    );
  }).finally(() => {
    void transition.finished.finally(() => document.documentElement.removeAttribute("data-theme-transitioning"));
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
