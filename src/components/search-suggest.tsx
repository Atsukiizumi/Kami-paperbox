/**
 * 搜索联想下拉。
 *
 * 作用：输入时合并已保存标签和源站补全，点选或回车搜。
 * 用法：放在浏览搜索框下面；onPick 收到完整查询词。
 * 为什么：图站补最后一个 token；Pixiv 整段都是一个词。粘贴 URL 不联想。
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSource } from "@/lib/source";
import { cookiesFromSettings } from "@/lib/store";
import {
  applySuggest,
  localMatches,
  mergeSuggest,
  shouldSuggest,
  suggestPrefix,
} from "@/lib/tag-suggest";
import type { Source } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SearchSuggest({
  source,
  query,
  saved,
  onPick,
}: {
  source: Source;
  query: string;
  saved: readonly string[];
  onPick: (word: string) => void;
}) {
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const prefix = suggestPrefix(source, debounced);
  const local = useMemo(() => localMatches(source, prefix, saved), [source, prefix, saved]);
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

  const items = useMemo(() => mergeSuggest(local, remote.data ?? []), [local, remote.data]);
  const open = shouldSuggest(query) && items.length > 0 && query.trim() === debounced.trim();

  useEffect(() => {
    setActive(0);
  }, [prefix, source]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
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
        onPick(applySuggest(source, query, hit.tag));
      } else if (e.key === "Escape") {
        setDebounced("");
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, items, active, onPick, query, source]);

  if (!open) return null;

  return (
    <ul
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
            onClick={() => onPick(applySuggest(source, query, item.tag))}
          >
            <span className="min-w-0 truncate">{item.tag.replace(/_/g, " ")}</span>
            {item.extra ? <span className="shrink-0 text-xs text-subtle">{item.extra}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
