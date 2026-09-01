/**
 * 搜索联想下拉。
 *
 * 作用：输入时合并已保存标签、最近搜过的词和源站补全；点选或回车搜。
 * 用法：放在浏览搜索框下面，传入同一 input 的 id；onPick 收到完整查询词。
 * 为什么：失焦必须收起（点候选项用 mousedown preventDefault，避免 blur 抢在 click 前）。
 *        候选项只负责填进搜索，不自动钉进快捷标签。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSource } from "@/lib/source";
import { cookiesFromSettings } from "@/lib/store";
import {
  applySuggest,
  localMatches,
  mergeSuggestLists,
  shouldSuggest,
  suggestPrefix,
} from "@/lib/tag-suggest";
import type { Source } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SearchSuggest({
  source,
  query,
  saved,
  recents = [],
  inputId,
  onPick,
}: {
  source: Source;
  query: string;
  saved: readonly string[];
  recents?: readonly string[];
  inputId: string;
  onPick: (word: string) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const prefix = suggestPrefix(source, debounced);
  const localSaved = useMemo(() => localMatches(source, prefix, saved), [source, prefix, saved]);
  const localRecent = useMemo(() => localMatches(source, prefix, recents), [source, prefix, recents]);
  const enabled = shouldSuggest(debounced) && prefix.length >= 1 && source !== "fanbox";

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), 200);
    return () => window.clearTimeout(id);
  }, [query]);

  const remote = useQuery({
    queryKey: ["tag-suggest", source, prefix],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const r = await fetchSource({
        data: { op: "tagSuggest", source, word: prefix, ...cookiesFromSettings() },
      });
      return r.op === "tagSuggest" ? r.items : [];
    },
  });

  const items = useMemo(
    () => mergeSuggestLists(localSaved, localRecent, remote.data ?? []),
    [localSaved, localRecent, remote.data],
  );
  const open =
    focused && shouldSuggest(query) && items.length > 0 && query.trim() === debounced.trim();

  useEffect(() => {
    setActive(0);
  }, [prefix, source]);

  useEffect(() => {
    const input = document.getElementById(inputId);
    if (!input) return;
    const onFocus = () => setFocused(true);
    const onBlur = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next && listRef.current?.contains(next)) return;
      window.setTimeout(() => {
        const ae = document.activeElement;
        if (ae === input || (ae && listRef.current?.contains(ae))) return;
        setFocused(false);
      }, 0);
    };
    input.addEventListener("focus", onFocus);
    input.addEventListener("blur", onBlur);
    return () => {
      input.removeEventListener("focus", onFocus);
      input.removeEventListener("blur", onBlur);
    };
  }, [inputId]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      const input = document.getElementById(inputId);
      if (input?.contains(target) || listRef.current?.contains(target)) return;
      setFocused(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [inputId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setFocused(false);
        return;
      }
      if (!open) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % items.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + items.length) % items.length);
      } else if (e.key === "Enter") {
        const hit = items[active];
        if (!hit) return;
        e.preventDefault();
        pick(applySuggest(source, query, hit.tag));
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, items, active, query, source]);

  function pick(word: string) {
    setFocused(false);
    onPick(word);
  }

  if (!open) return null;

  return (
    <ul
      ref={listRef}
      role="listbox"
      className="absolute z-40 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-float)]"
    >
      {items.map((item, i) => (
        <li key={item.tag}>
          <button
            type="button"
            role="option"
            aria-selected={i === active}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm",
              i === active ? "bg-elevated text-fg" : "text-fg hover:bg-elevated",
            )}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(applySuggest(source, query, item.tag))}
          >
            <span className="min-w-0 truncate">{item.tag.replace(/_/g, " ")}</span>
            {item.extra ? <span className="shrink-0 text-xs text-subtle">{item.extra}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
