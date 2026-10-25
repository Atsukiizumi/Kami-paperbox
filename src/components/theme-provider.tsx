import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import {
  applyDocumentTheme,
  type ResolvedAppearance,
} from "@/lib/theme";
import { useSettings, onPersisted } from "@/lib/store";
import { useActiveThemePack } from "@/lib/theme-pack-client";
import type { ThemePackInfo } from "@/lib/theme-pack";
import { shellRenderPlan } from "@/lib/desk-layout";
import { setUiMotionEnabled } from "@/lib/motion-runtime";

const ResolvedAppearanceContext = createContext<ResolvedAppearance>("dark");

function themeColorMeta(): HTMLMetaElement | null {
  return document.querySelector('meta[name="theme-color"]');
}

/** palette.overrides 的 token 键 → CSS 变量名（accentFg → --color-accent-fg）。 */
function tokenVarName(key: string): string {
  return `--color-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
}

/** 主题包 css 注入位（常驻 head，内容随包换；无包时摘除节点）。 */
function themeCssElement(): HTMLStyleElement {
  const existing = document.querySelector<HTMLStyleElement>("style[data-kami-theme-css]");
  if (existing) return existing;
  const el = document.createElement("style");
  el.setAttribute("data-kami-theme-css", "");
  document.head.appendChild(el);
  return el;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSettings((s) => s.theme);
  const appearance = useSettings((s) => s.appearance);
  const uiStyle = useSettings((s) => s.uiStyle);
  const motionEnabled = useSettings((s) => s.motionEnabled);
  const shell = useSettings((s) => s.shell);
  const pageLayout = useSettings((s) => s.pageLayout);
  const themePackSettings = useSettings((s) => s.themePack);
  const { pack } = useActiveThemePack();
  const [resolved, setResolved] = useState<ResolvedAppearance>("dark");

  useLayoutEffect(() => {
    let stopMedia: (() => void) | undefined;

    const apply = () => {
      const state = useSettings.getState();
      // 两层合并（P2）：激活包 + 跟随开关 > 用户设置 > 内置默认。
      // palette 恒随包（配色就是主题的本体）；shell/layout 各有跟随开关。
      const packShell: ThemePackInfo["manifest"]["shell"] | undefined =
        state.themePack.activeId && state.themePack.followShell ? pack?.manifest.shell : undefined;
      const effectiveShell = packShell ?? state.shell;
      const effectiveTheme = pack?.manifest.palette?.base ?? state.theme;
      const next = applyDocumentTheme(effectiveTheme, state.appearance, {
        root: document.documentElement,
        themeColorMeta: themeColorMeta(),
      });
      setResolved(next.resolved);
      // 界面风格（手绘记号层）：clean 移除属性，hand 挂上——styles.css 按属性切换。
      if (state.uiStyle === "hand") document.documentElement.setAttribute("data-kami-style", "hand");
      else document.documentElement.removeAttribute("data-kami-style");
      // 动效总开关：styles.css 按 data-motion="off" 关停过渡/动画（不读系统设置）；
      // JS 侧同一开关同步进运行时——水合后策略才明确，之前一律不起播。
      document.documentElement.setAttribute("data-motion", state.motionEnabled ? "on" : "off");
      setUiMotionEnabled(state.motionEnabled);
      // 本页关过动效：页面骨架的入场类不再重播（animation:none 恢复会从头来）
      if (!state.motionEnabled) document.documentElement.setAttribute("data-motion-stopped", "");
      // 外壳形态 / 页宽 / 纸匣列宽（布局引擎 P1）：属性驱动，styles.css 按值切换，
      // 仅 md+ 生效——移动端走自己的顶栏+底部栏，属性选择器都裹在 min-width 里。
      // 外壳属性统一由渲染计划给出（P3）：结构守卫（导航可达/胶囊避让）集中在
      // shellRenderPlan，此处与 AppShell 消费同一份决策。
      const plan = shellRenderPlan(effectiveShell);
      document.documentElement.setAttribute("data-shell-form", plan.custom ? "custom" : effectiveShell.form);
      document.documentElement.setAttribute("data-content-width", plan.contentWidth);
      document.documentElement.setAttribute("data-topbar", plan.topbarVisible ? "on" : "off");
      document.documentElement.setAttribute("data-topbar-density", plan.topbarCompact ? "compact" : "normal");
      document.documentElement.setAttribute("data-shell-side", plan.sidebarSide);
      if (plan.custom) {
        document.documentElement.style.setProperty("--kami-sidebar-w", `${plan.sidebarW ?? 0}px`);
        document.documentElement.style.setProperty(
          "--kami-content-pad",
          plan.sidebarMode === "hidden" ? "0px" : `${plan.sidebarW ?? 224}px`,
        );
      } else {
        document.documentElement.style.removeProperty("--kami-sidebar-w");
        document.documentElement.style.removeProperty("--kami-content-pad");
      }
      document.documentElement.setAttribute("data-vault-col", state.pageLayout.vaultCol);
      document.documentElement.setAttribute(
        "data-content-margin",
        effectiveShell.form === "zen" && effectiveShell.tweaks.contentMargin === "tight" ? "tight" : "normal",
      );

      // 主题包（P2）：激活标记 + palette 行内覆盖 + css 注入；停用/缺包全摘干净。
      // 行内变量先全清再设——换包时旧包独有的键不会残留成陈值。
      const root = document.documentElement;
      for (const key of ["bg", "surface", "elevated", "fg", "muted", "subtle", "accent", "accentFg", "danger", "ok"]) {
        root.style.removeProperty(tokenVarName(key));
      }
      const overrides = pack?.manifest.palette?.overrides;
      if (pack && state.themePack.activeId) {
        root.setAttribute("data-kami-theme", pack.id);
        if (overrides) {
          for (const [key, value] of Object.entries(overrides)) {
            root.style.setProperty(tokenVarName(key), value);
          }
        }
        themeCssElement().textContent = pack.css ?? "";
      } else {
        root.removeAttribute("data-kami-theme");
        document.querySelector("style[data-kami-theme-css]")?.remove();
      }
    };

    const listenMedia = () => {
      stopMedia?.();
      stopMedia = undefined;
      if (useSettings.getState().appearance !== "system") return;
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      stopMedia = () => mq.removeEventListener("change", apply);
    };

    const ready = () => {
      apply();
      listenMedia();
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          document.documentElement.classList.add("kami-motion");
        });
      });
    };

    // 水合门（persist 缺席/已水合都立即 apply，否则等水合完成）——语义就是
    // store.onPersisted，不再自己摸 persist API。
    const unsub = onPersisted(useSettings, ready);
    return () => {
      unsub();
      stopMedia?.();
    };
  }, [theme, appearance, uiStyle, motionEnabled, shell, pageLayout, themePackSettings, pack]);

  return (
    <ResolvedAppearanceContext.Provider value={resolved}>
      {children}
    </ResolvedAppearanceContext.Provider>
  );
}

export function useResolvedAppearance(): ResolvedAppearance {
  return useContext(ResolvedAppearanceContext);
}
