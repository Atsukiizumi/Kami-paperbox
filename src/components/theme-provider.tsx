import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import {
  applyDocumentTheme,
  type ResolvedAppearance,
} from "@/lib/theme";
import { useSettings } from "@/lib/store";

const ResolvedAppearanceContext = createContext<ResolvedAppearance>("dark");

function themeColorMeta(): HTMLMetaElement | null {
  return document.querySelector('meta[name="theme-color"]');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSettings((s) => s.theme);
  const appearance = useSettings((s) => s.appearance);
  const uiStyle = useSettings((s) => s.uiStyle);
  const [resolved, setResolved] = useState<ResolvedAppearance>("dark");

  useLayoutEffect(() => {
    let stopMedia: (() => void) | undefined;

    const apply = () => {
      const state = useSettings.getState();
      const next = applyDocumentTheme(state.theme, state.appearance, {
        root: document.documentElement,
        themeColorMeta: themeColorMeta(),
      });
      setResolved(next.resolved);
      // 界面风格（手绘记号层）：clean 移除属性，hand 挂上——styles.css 按属性切换。
      if (state.uiStyle === "hand") document.documentElement.setAttribute("data-kami-style", "hand");
      else document.documentElement.removeAttribute("data-kami-style");
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

    if (useSettings.persist.hasHydrated()) {
      ready();
      return () => stopMedia?.();
    }

    const unsub = useSettings.persist.onFinishHydration(ready);
    return () => {
      unsub();
      stopMedia?.();
    };
  }, [theme, appearance, uiStyle]);

  return (
    <ResolvedAppearanceContext.Provider value={resolved}>
      {children}
    </ResolvedAppearanceContext.Provider>
  );
}

export function useResolvedAppearance(): ResolvedAppearance {
  return useContext(ResolvedAppearanceContext);
}
