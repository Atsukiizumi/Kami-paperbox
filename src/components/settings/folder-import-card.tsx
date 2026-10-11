/**
 * 「从文件夹导入」卡（存量导入，design 2.4-2.5 / PRD L1-L5）。
 *
 * 作用：两步式导入——扫描授权文件夹（进度 toast，超限由扫描层抛错中止）→ 预览
 *      Dialog（新导入/跳过/无法识别三数 + 清单可展开 + 批级站点选择）→ 执行导入并
 *      汇报。无 {source} 模板的匹配文件必须先选站点才能导入（design 7 待定项 1 已拍板）。
 * 用法：StorageSection 挂 <FolderImportCard granted={granted} />；scan/loadKeys/runImport
 *      是组件测试注入缝（照 TagTidyCard items 先例），默认走 folder-import 的 IO 链。
 * 为什么：扫描和写入拆两步，用户先看清单再落笔；批级站点一次选择管整批——逐文件
 *      指认已被 PRD 否掉，反解层不猜站点，未选站前匹配文件停在无法识别侧。
 */
import { useMemo, useState } from "react";
import { FolderInput } from "lucide-react";
import { toast } from "sonner";
import { useSettings } from "@/lib/store";
import { SITE_LIST } from "@/lib/sites";
import {
  collectExistingKeys,
  executeImportPlan,
  planFolderImport,
  scanFolderForImport,
} from "@/lib/storage/folder-import";
import type { ImportExecution, ImportPlan, ImportScanResult } from "@/lib/storage/folder-import";
import type { Source } from "@/lib/types";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

// 重试/进度面 toast 必须带固定 id（同 id 折叠刷新，见 quality-guidelines）
const IMPORT_TOAST_ID = "kami-folder-import";
const PROGRESS_STEP = 200;
const UNRECOGNIZED_LIMIT = 200;

type Phase = "idle" | "scanning" | "preview" | "importing" | "done";

export function FolderImportCard({
  granted,
  scan = scanFolderForImport,
  loadKeys = collectExistingKeys,
  runImport = executeImportPlan,
}: {
  granted: boolean;
  scan?: typeof scanFolderForImport;
  loadKeys?: typeof collectExistingKeys;
  runImport?: typeof executeImportPlan;
}) {
  const pathTemplate = useSettings((s) => s.pathTemplate);
  const folderLabel = useSettings((s) => s.folderLabel);
  const [phase, setPhase] = useState<Phase>("idle");
  const [files, setFiles] = useState<ImportScanResult[]>([]);
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set());
  const [batchSource, setBatchSource] = useState<Source | undefined>(undefined);
  const [outcome, setOutcome] = useState<ImportExecution | null>(null);
  const [listOpen, setListOpen] = useState(false);

  const plan = useMemo<ImportPlan>(
    () => planFolderImport(files, pathTemplate, keys, { batchSource, folderLabel }),
    [files, pathTemplate, keys, batchSource, folderLabel],
  );
  // {source} 在模板里时反解自带站点，批级选择整个不需要出现
  const needsBatchSource = !/\{source\}/i.test(pathTemplate);
  const importBlocked = (needsBatchSource && !batchSource) || plan.records.length === 0;

  async function handleScan() {
    setPhase("scanning");
    setListOpen(false);
    toast.loading("正在扫描文件夹…", { id: IMPORT_TOAST_ID });
    try {
      let reported = 0;
      const found = await scan({
        onProgress: (resolved) => {
          if (resolved >= reported + PROGRESS_STEP) {
            reported = resolved;
            toast.loading(`正在扫描文件夹… 已读 ${resolved} 个文件`, { id: IMPORT_TOAST_ID });
          }
        },
      });
      const foundKeys = await loadKeys();
      setFiles(found);
      setKeys(foundKeys);
      setOutcome(null);
      setBatchSource(undefined);
      setPhase("preview");
      toast.dismiss(IMPORT_TOAST_ID);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "扫描失败", { id: IMPORT_TOAST_ID });
      setPhase("idle");
    }
  }

  async function handleImport() {
    if (!plan || importBlocked) return;
    setPhase("importing");
    toast.loading("正在导入…", { id: IMPORT_TOAST_ID });
    try {
      let reported = 0;
      const result = await runImport(plan, {
        onProgress: (done) => {
          if (done >= reported + PROGRESS_STEP) {
            reported = done;
            toast.loading(`正在导入… ${done}/${plan.records.length}`, { id: IMPORT_TOAST_ID });
          }
        },
      });
      setOutcome(result);
      setPhase("done");
      toast.dismiss(IMPORT_TOAST_ID);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导入失败", { id: IMPORT_TOAST_ID });
      setPhase("preview");
    }
  }

  const dialogOpen = phase === "preview" || phase === "importing" || phase === "done";

  return (
    <Card>
      <CardHeader>
        <CardTitle>从文件夹导入</CardTitle>
        <CardDescription>
          把已下载的存量按当前分类规则反解回纸匣：只记路径不复制像素，无法识别的只列清单不猜站点。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-bg p-3">
          <p className="text-xs text-muted">
            {granted
              ? `将扫描「${folderLabel}」含子文件夹（最深 6 层、至多 20000 张），已入匣的自动跳过。`
              : "需要先在上方选择并授权下载文件夹，才能扫描导入。"}
          </p>
          <Button
            type="button"
            variant="secondary"
            disabled={!granted || phase === "scanning" || phase === "importing"}
            onClick={() => void handleScan()}
          >
            <FolderInput className="size-4" />
            {phase === "scanning" ? "扫描中…" : "扫描文件夹"}
          </Button>
        </div>

        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            if (!open && phase !== "importing") setPhase("idle");
          }}
        >
          <DialogContent aria-label={phase === "done" ? "导入完成" : "导入预览"}>
            {phase === "done" && outcome ? (
              <>
                <DialogTitle>导入完成</DialogTitle>
                <DialogDescription>
                  新导入 {outcome.imported} 条 · 跳过已在匣 {plan.skippedInVault} 条 · 无法识别{" "}
                  {plan.unrecognized.length} 个
                </DialogDescription>
                <div className="space-y-2 text-sm text-muted">
                  {outcome.serverFailed > 0 ? (
                    <p className="text-danger">{outcome.serverFailed} 条服务端目录上报失败（本机纸匣已写入，可整体重跑补齐）。</p>
                  ) : null}
                  {outcome.failed > 0 ? (
                    <p className="text-danger">{outcome.failed} 条写入失败（已收集，整体重跑按 key 幂等补齐）。</p>
                  ) : null}
                  {outcome.serverFailed === 0 && outcome.failed === 0 ? (
                    <p>全部写入成功。重跑同一批只会全部计为「跳过已在匣」。</p>
                  ) : null}
                </div>
                <div className="mt-4 flex justify-end">
                  <Button type="button" onClick={() => setPhase("idle")}>
                    完成
                  </Button>
                </div>
              </>
            ) : (
              <>
                <DialogTitle>导入预览</DialogTitle>
                <DialogDescription>
                  新导入 {plan.records.length} 条 · 跳过已在匣 {plan.skippedInVault} 条 · 无法识别{" "}
                  {plan.unrecognized.length} 个
                </DialogDescription>

                <div className="space-y-3 text-sm">
                  {needsBatchSource ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-muted">当前模板没有 {"{source}"}，整批按所选站点入匣：</span>
                      <Select value={batchSource} onValueChange={(v) => setBatchSource(v as Source)}>
                        <SelectTrigger className="h-8 w-[140px]" aria-label="批级站点">
                          <SelectValue placeholder="选择站点" />
                        </SelectTrigger>
                        <SelectContent>
                          {SITE_LIST.map((site) => (
                            <SelectItem key={site.id} value={site.id}>
                              {site.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    className="text-left text-xs text-muted underline underline-offset-4 hover:text-fg"
                    aria-expanded={listOpen}
                    onClick={() => setListOpen((v) => !v)}
                  >
                    无法识别清单（{plan.unrecognized.length}）
                  </button>
                  {listOpen ? (
                    plan.unrecognized.length === 0 ? (
                      <p className="text-xs text-subtle">没有无法识别的文件。</p>
                    ) : (
                      <ul className="max-h-48 overflow-auto rounded-md bg-bg p-2 font-mono text-xs text-muted">
                        {plan.unrecognized.slice(0, UNRECOGNIZED_LIMIT).map((path) => (
                          <li key={path}>{path}</li>
                        ))}
                        {plan.unrecognized.length > UNRECOGNIZED_LIMIT ? (
                          <li>…其余 {plan.unrecognized.length - UNRECOGNIZED_LIMIT} 个</li>
                        ) : null}
                      </ul>
                    )
                  ) : null}
                </div>

                <div className="mt-4 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={phase === "importing"}
                    onClick={() => setPhase("idle")}
                  >
                    取消
                  </Button>
                  <Button
                    type="button"
                    disabled={phase === "importing" || importBlocked}
                    onClick={() => void handleImport()}
                  >
                    {phase === "importing" ? "导入中…" : `开始导入（${plan.records.length}）`}
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
