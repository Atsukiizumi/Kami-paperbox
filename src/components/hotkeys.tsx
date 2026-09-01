/**
 * 全局快捷键。
 *
 * 作用：/ 聚焦浏览搜索；Esc 关掉输入或返回上一页。
 * 用法：AppShell 里挂一次。输入框里不抢键。
 * 为什么：图站浏览时手不离键盘更快；灯箱自己处理方向键。
 */
import { useEffect } from "react";
import { useCanGoBack, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  return Boolean(el.closest("input, textarea, select, [contenteditable='true']"));
}

export function AppHotkeys() {
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/" && !isTypingTarget(e.target)) {
        e.preventDefault();
        const box = document.getElementById("kami-search") as HTMLInputElement | null;
        if (box) {
          box.focus();
          box.select();
          return;
        }
        void navigate({ to: "/" }).then(() => {
          requestAnimationFrame(() => {
            const next = document.getElementById("kami-search") as HTMLInputElement | null;
            next?.focus();
            next?.select();
          });
        });
        return;
      }
      if (e.key !== "Escape") return;
      if (document.querySelector('[role="dialog"]')) return;
      if (isTypingTarget(e.target)) {
        (e.target as HTMLElement).blur();
        return;
      }
      const detail =
        pathname.startsWith("/work/") ||
        pathname.startsWith("/user/") ||
        pathname.startsWith("/creator/");
      if (detail && canGoBack) {
        e.preventDefault();
        router.history.back();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canGoBack, navigate, pathname, router]);

  return null;
}
