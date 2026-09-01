/**
 * 把图片拖进窗口去搜图。
 *
 * 作用：任意页拖入图片，进搜图页并自动开搜。已在搜图页则直接用这张。
 * 用法：AppShell 挂一次。
 * 为什么：从桌面或别的标签拖图，比先点进搜图再选文件快。
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { stashReverseImage } from "@/lib/reverse-search";

export const SEARCH_FILE_EVENT = "kami-search-file";

function isFileDrag(e: DragEvent) {
  return Boolean(e.dataTransfer?.types?.includes("Files"));
}

export function DropToSearch() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [over, setOver] = useState(false);

  useEffect(() => {
    let depth = 0;
    function enter(e: DragEvent) {
      if (!isFileDrag(e)) return;
      depth += 1;
      setOver(true);
    }
    function leave() {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    }
    function overMove(e: DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
    }
    async function drop(e: DragEvent) {
      depth = 0;
      setOver(false);
      const file = [...(e.dataTransfer?.files ?? [])].find((item) => item.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      if (pathname.startsWith("/search")) {
        window.dispatchEvent(new CustomEvent(SEARCH_FILE_EVENT, { detail: file }));
        return;
      }
      const bytes = await file.arrayBuffer();
      stashReverseImage({ name: file.name, type: file.type, bytes });
      void navigate({ to: "/search" });
    }
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overMove);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overMove);
      window.removeEventListener("drop", drop);
    };
  }, [navigate, pathname]);

  if (!over || typeof document === "undefined") return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-overlay">
      <p className="rounded-2xl bg-surface px-6 py-4 font-display text-xl tracking-tight text-fg shadow-[var(--shadow-float)]">
        放到这里搜图
      </p>
    </div>,
    document.body,
  );
}
