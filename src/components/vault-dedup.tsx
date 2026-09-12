"use client";

/**
 * 纸匣查重视图（智能库）。
 *
 * 作用：扫描（服务端补算哈希 + 聚类）→ 候选组并排展示 → 逐张删除 / 按对忽略。
 * 用法：<VaultDedup items={纸匣全部 meta} onChanged={删除后刷新父列表} />。
 * 为什么忽略对持久化而组不持久化：重算是毫秒级，忽略/删除后重算即时生效。
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { getVaultBlob } from "@/lib/vault";
import { vaultPageUrl } from "@/lib/vault-sync";
import { previewFromFolder } from "@/lib/persist-files";
import { formatBytes } from "@/lib/utils";
import type { VaultMeta } from "@/lib/types";

type DupGroup = { keys: string[]; maxDistance: number };
type ScanResponse = { ok: boolean; groups?: DupGroup[]; hashed?: number; total?: number; error?: string };

function useThumb(item: VaultMeta) {
  const serverThumb = item.hasFile ? vaultPageUrl(item.key, 0) : "";
  const [thumb, setThumb] = useState(serverThumb);
  useEffect(() => {
    let cancelled = false;
    let url = "";
    void (async () => {
      const blob = (await previewFromFolder(item)) || (await getVaultBlob(item.key, 0));
      if (cancelled) return;
      if (blob) {
        url = URL.createObjectURL(blob);
        setThumb(url);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item]);
  return thumb;
}

function DedupCard({
  item,
  onDelete,
}: {
  item: VaultMeta;
  onDelete: () => void;
}) {
  const thumb = useThumb(item);
  return (
    <div className="flex gap-3 rounded-lg bg-elevated/60 p-2">
      {thumb ? (
        <img src={thumb} alt={item.title} className="size-24 shrink-0 rounded-md object-cover" loading="lazy" />
      ) : (
        <div className="grid size-24 shrink-0 place-items-center rounded-md bg-fg/5 text-xs text-subtle">无预览</div>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm font-medium">{item.title}</p>
        <p className="text-xs text-muted">
          {item.source} · {item.author || "未知作者"} · {formatBytes(item.bytes)}
        </p>
        <div className="pt-1">
          <Button size="sm" variant="secondary" onClick={onDelete}>
            删除这张
          </Button>
        </div>
      </div>
    </div>
  );
}

export function VaultDedup({
  items,
  onChanged,
  onDismissed,
}: {
  items: VaultMeta[];
  /** 删除成功后通知父级刷新列表。 */
  onChanged: () => void | Promise<void>;
  /** 忽略对后刷新候选组。 */
  onDismissed?: () => void;
}) {
  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);
  const [groups, setGroups] = useState<DupGroup[]>([]);
  const [coverage, setCoverage] = useState<{ hashed: number; total: number }>({ hashed: 0, total: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/vault/dedup", { cache: "no-store" });
      const data = (await res.json()) as ScanResponse;
      if (data.ok && data.groups) {
        setGroups(data.groups);
        setCoverage({ hashed: data.hashed ?? 0, total: data.total ?? 0 });
      }
    } catch {
      /* 服务端不可用：保持空态 */
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function scan() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/vault/dedup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "scan" }),
      });
      const data = (await res.json()) as ScanResponse;
      if (!data.ok) throw new Error(data.error || "扫描失败");
      setGroups(data.groups ?? []);
      setCoverage({ hashed: data.hashed ?? 0, total: data.total ?? 0 });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "扫描失败");
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(keys: string[]) {
    // 组内两两忽略（组是聚类，人对的是「这些是同一张」整组）
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        await fetch("/api/vault/dedup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "dismiss", a: keys[i], b: keys[j] }),
        }).catch(() => undefined);
      }
    }
    setGroups((prev) => prev.filter((g) => g.keys !== keys));
    onDismissed?.();
    await load();
  }

  async function removeOne(key: string) {
    const res = await fetch(`/api/vault?key=${encodeURIComponent(key)}`, { method: "DELETE" });
    if (!res.ok) {
      setMessage("删除失败");
      return;
    }
    setGroups((prev) =>
      prev
        .map((g) => ({ ...g, keys: g.keys.filter((k) => k !== key) }))
        .filter((g) => g.keys.length >= 2),
    );
    await onChanged();
  }

  const live = groups.filter((g) => g.keys.length >= 2);

  return (
    <section className="space-y-4 rounded-lg border border-fg/10 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium">查重</h2>
        <Button size="sm" onClick={() => void scan()} disabled={busy}>
          {busy ? "扫描中…" : live.length > 0 || coverage.hashed > 0 ? "重新扫描" : "扫描重复"}
        </Button>
        <span className="text-xs tabular-nums text-subtle">
          哈希覆盖 {coverage.hashed}/{coverage.total}
          {live.length > 0 ? ` · 疑似重复 ${live.length} 组` : ""}
        </span>
        {message ? <span className="text-xs text-danger">{message}</span> : null}
      </div>
      {live.length === 0 && !busy ? (
        <p className="text-sm text-muted">
          {coverage.hashed === 0 ? "还没有哈希——点「扫描重复」给库建索引。" : "没有发现重复。"}
        </p>
      ) : (
        <div className="space-y-4">
          {live.map((group) => (
            <div key={group.keys.join("|")} className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted">
                <span>疑似同图 · 距离 {group.maxDistance}</span>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => void dismiss(group.keys)}>
                  都保留（忽略）
                </Button>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {group.keys.map((key) => {
                  const item = byKey.get(key);
                  if (!item) return null;
                  return <DedupCard key={key} item={item} onDelete={() => void removeOne(key)} />;
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
