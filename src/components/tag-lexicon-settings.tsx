/**
 * 图站标签译文。
 *
 * 作用：导出已收集的英文 tag，用户填 zh 后再导回来。界面显示中文，搜索仍用英文。
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import {
  TAG_LEXICON_FORMAT,
  mergeExportRows,
  parseTagLexicon,
  useTagLexicon,
} from "@/lib/tag-lexicon";
import { useSettings } from "@/lib/store";
import { listVault } from "@/lib/vault";
import { downloadBlob } from "@/lib/vault";

export function TagLexiconSection() {
  const saved = useSettings((s) => s.savedTags);
  const rows = useTagLexicon((s) => s.rows);
  const setRows = useTagLexicon((s) => s.setRows);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const translated = rows.filter((r) => r.zh).length;

  async function exportJson() {
    setBusy(true);
    try {
      const vault = await listVault();
      const known = [
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
      toast.success("已导出标签清单，填好 zh 再导回来");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败");
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
    <Card>
      <CardHeader>
        <CardTitle>图站标签译文</CardTitle>
        <CardDescription>
          Yande / Konachan / Danbooru 界面显示中文，搜索仍发英文 tag。导出 JSON（字段 en / zh），自己翻译后再导入。用户译文覆盖内置词表。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={busy} onClick={() => void exportJson()}>
          导出标签清单
        </Button>
        <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
          导入译文
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
        <p className="text-xs text-muted">已覆盖 {translated} 条</p>
      </CardContent>
    </Card>
  );
}
