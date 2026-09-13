/**
 * 图站标签仓库。
 *
 * 作用：浏览时收到的英文 tag 存在本机；这里检索、补中文。搜索请求仍用英文。
 * 用法：在设置「词表」页搜索 en / zh，改译文后立刻覆盖显示。
 */
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import {
  TAG_LEXICON_FORMAT,
  mergeExportRows,
  parseTagLexicon,
  useTagLexicon,
} from "@/lib/tag-lexicon";
import { catalogKeys, useTagCatalog, type TagCatalogEntry } from "@/lib/tag-catalog";
import { TAG_DATABASE, TAG_NAMESPACES, type TagNamespace } from "@/lib/tag-database";
import { useSettings } from "@/lib/store";
import { listVault, downloadBlob } from "@/lib/storage/vault";

const PAGE_SIZE = 80;

export function TagLexiconSection() {
  const saved = useSettings((s) => s.savedTags);
  const rows = useTagLexicon((s) => s.rows);
  const setRows = useTagLexicon((s) => s.setRows);
  const setZh = useTagLexicon((s) => s.setZh);
  const entries = useTagCatalog((s) => s.entries);
  const ingestMany = useTagCatalog((s) => s.ingestMany);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [ns, setNs] = useState<TagNamespace | "all">("all");

  const zhMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of TAG_DATABASE) if (row.zh) map.set(row.en, row.zh);
    for (const row of rows) if (row.zh) map.set(row.en, row.zh);
    return map;
  }, [rows]);

  const warehouse = useMemo(() => {
    const map = new Map<string, TagCatalogEntry & { ns?: TagNamespace }>();
    for (const row of TAG_DATABASE) {
      map.set(row.en, {
        en: row.en,
        count: row.count,
        lastSeen: 0,
        sites: [],
        ns: row.ns,
      });
    }
    for (const row of entries) {
      const prev = map.get(row.en);
      map.set(row.en, {
        ...row,
        ns: prev?.ns,
        count: Math.max(row.count, prev?.count ?? 0),
      });
    }
    return [...map.values()];
  }, [entries]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return warehouse.filter((row) => {
      const zh = zhMap.get(row.en) ?? "";
      if (onlyOpen && zh) return false;
      if (ns !== "all" && row.ns && row.ns !== ns) return false;
      if (!needle) return true;
      return row.en.includes(needle) || zh.toLowerCase().includes(needle);
    });
  }, [warehouse, zhMap, q, onlyOpen, ns]);

  const translated = warehouse.filter((row) => Boolean(zhMap.get(row.en))).length;

  async function exportJson() {
    setBusy(true);
    try {
      const vault = await listVault();
      const known = [
        ...catalogKeys(entries),
        ...saved.yande,
        ...saved.konachan,
        ...saved.danbooru,
        ...vault.flatMap((item) => item.tags),
      ];
      const payload = {
        format: TAG_LEXICON_FORMAT,
        tags: mergeExportRows(known, rows),
      };
      const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
      downloadBlob(blob, "kami-tag-lexicon.json");
      toast.success("已导出仓库清单");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败");
    } finally {
      setBusy(false);
    }
  }

  async function scanVault() {
    setBusy(true);
    try {
      const vault = await listVault();
      ingestMany(vault.map((item) => ({ source: item.source, tags: item.tags })));
      toast.success(`已从纸匣扫入 ${vault.length} 条作品的标签`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "扫描失败");
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    try {
      const parsed = parseTagLexicon(JSON.parse(await file.text()));
      setRows(parsed.filter((row) => row.zh));
      toast.success(`已读入 ${parsed.filter((row) => row.zh).length} 条译文`);
    } catch {
      toast.error("JSON 无效。需要 { tags: [{ en, zh }] }");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>图站标签仓库</CardTitle>
          <CardDescription>
            浏览 Yande / Konachan / Danbooru 时自动收词。内置数据库按命名空间收录高频 tag，用户译文覆盖库内同一 en。搜索仍发英文。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted">
            库内 {TAG_DATABASE.length} · 已收 {entries.length} · 已译 {translated} · 未译 {Math.max(0, warehouse.length - translated)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => void exportJson()}>
              导出
            </Button>
            <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
              导入译文
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void scanVault()}>
              从纸匣扫入
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importFile(file);
              }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜英文或中文"
              className="min-w-40 flex-1"
            />
            <Button type="button" variant={onlyOpen ? "default" : "secondary"} onClick={() => setOnlyOpen((v) => !v)}>
              {onlyOpen ? "只看未译" : "全部"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            <Button type="button" size="sm" variant={ns === "all" ? "default" : "ghost"} onClick={() => setNs("all")}>
              全部命名空间
            </Button>
            {TAG_NAMESPACES.map((item) => (
              <Button
                key={item}
                type="button"
                size="sm"
                variant={ns === item ? "default" : "ghost"}
                onClick={() => setNs(item)}
              >
                {item}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {warehouse.length === 0 ? (
        <p className="text-sm text-muted">还没有词。去图站逛几页，或从纸匣扫入。</p>
      ) : (
        <ul className="divide-y divide-border/70 rounded-xl border border-border/70">
          {filtered.slice(0, PAGE_SIZE).map((row) => (
            <li key={row.en} className="grid gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <p className="truncate font-mono text-xs text-muted" title={row.en}>
                {row.en}
              </p>
              <Input
                defaultValue={zhMap.get(row.en) ?? ""}
                placeholder="中文"
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next === (zhMap.get(row.en) ?? "")) return;
                  setZh(row.en, next);
                }}
              />
              <p className="text-xs text-subtle">
                {row.count} · {row.sites.join("/")}
              </p>
            </li>
          ))}
        </ul>
      )}
      {filtered.length > PAGE_SIZE ? (
        <p className="text-xs text-subtle">只列出前 {PAGE_SIZE} 条，缩小搜索再看。</p>
      ) : null}
    </div>
  );
}
