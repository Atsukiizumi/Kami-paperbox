import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import {
  THEME_LIST,
  type Appearance,
  type ThemeId,
  themeTokens,
} from "@/lib/theme";
import { useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useResolvedAppearance } from "@/components/theme-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
            onClick={() => setTheme(def.id)}
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
          className="inline-flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-fg"
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
          <DropdownMenuItem key={def.id} onSelect={() => setTheme(def.id)}>
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
