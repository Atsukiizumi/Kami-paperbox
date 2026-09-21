/**
 * 设置「存储」页。
 *
 * 作用：选下载文件夹 / 应用内目录、路径模板预设，看占用与重扫；超 30 天
 *      未备份时以 .kami-slip 笺条提醒（M5）。
 * 用法：设置分类里打开；文件夹授权、占用统计都在此分区。
 */
import { DatabaseZap, FolderOpen, FolderX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  formatDownloadPath,
  PATH_PRESETS,
  PATH_TOKEN_HELP,
  SAMPLE_PATH_CONTEXT,
} from "@/lib/storage/download-path";
import {
  canPickFolder,
  clearFolderHandle,
  folderPermissionState,
  pickDownloadFolder,
} from "@/lib/folder-access";
import { useSettings } from "@/lib/store";
import { cn, formatBytes } from "@/lib/utils";
import { isBackupOverdue } from "./backup-reminder";
import { rescanFolderHashes } from "@/lib/storage/persist-files";
import { backfillTargets, runVaultBackfill } from "@/lib/storage/vault-backfill";
import { listVault } from "@/lib/storage/vault";
import { requestVaultPersistence, vaultStorageEstimate } from "@/lib/storage/vault";
import { listServerVault } from "@/lib/storage/vault-sync";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { AuthorTidyCard } from "./author-tidy";
import { TagTidyCard } from "./tag-tidy";

export function StorageSection() {
  const folderLabel = useSettings((s) => s.folderLabel);
  const lastBackupAt = useSettings((s) => s.lastBackupAt);
  const vaultMirrorFolder = useSettings((s) => s.vaultMirrorFolder);
  const downloadToFolder = useSettings((s) => s.downloadToFolder);
  const pathPreset = useSettings((s) => s.pathPreset);
  const pathTemplate = useSettings((s) => s.pathTemplate);
  const setFolderLabel = useSettings((s) => s.setFolderLabel);
  const setVaultMirrorFolder = useSettings((s) => s.setVaultMirrorFolder);
  const setDownloadToFolder = useSettings((s) => s.setDownloadToFolder);
  const setPathPreset = useSettings((s) => s.setPathPreset);
  const setPathTemplate = useSettings((s) => s.setPathTemplate);

  const [pickerOk, setPickerOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [granted, setGranted] = useState(false);
  const [persisted, setPersisted] = useState(false);
  const [usage, setUsage] = useState("");
  const [serverLine, setServerLine] = useState("");
  const [backfillCount, setBackfillCount] = useState<number | null>(null);
  const backfillCancel = useRef(false);
  const templateRef = useRef<HTMLInputElement>(null);

  async function refreshStatus() {
    const state = await folderPermissionState();
    setGranted(state === "granted");
    const estimate = await vaultStorageEstimate();
    setPersisted(estimate.persisted);
    if (estimate.usage > 0 || estimate.quota > 0) {
      setUsage(
        estimate.quota
          ? `${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)}`
          : formatBytes(estimate.usage),
      );
    }
    const remote = await listServerVault();
    if (remote) {
      setServerLine(`应用内备份 · ${remote.totals.count} 条 · ${formatBytes(remote.totals.bytes)}`);
    } else {
      setServerLine("");
    }
  }

  useEffect(() => {
    setPickerOk(canPickFolder());
    void requestVaultPersistence().then((ok) => setPersisted(ok));
    void refreshStatus();
    // 档案补全待补计数（三字段全缺 = unknown）；拉不到不阻塞分区
    void listVault()
      .then((items) => setBackfillCount(backfillTargets(items).length))
      .catch(() => setBackfillCount(null));
  }, []);

  async function runBackfill() {
    if (busy) {
      backfillCancel.current = true; // 再点 = 取消
      return;
    }
    setBusy(true);
    backfillCancel.current = false;
    try {
      const r = await runVaultBackfill({
        onProgress: (p) => {
          toast.message(`补全档案 ${p.done}/${p.total}（失败 ${p.failed}）`, { id: "kami-backfill" });
          return backfillCancel.current ? false : undefined;
        },
      });
      const items = await listVault();
      setBackfillCount(backfillTargets(items).length);
      if (r.remaining > 0) toast.info(`已取消：完成 ${r.ok} 条，剩 ${r.remaining} 条待补`, { id: "kami-backfill" });
      else if (r.failed > 0) toast.warning(`补全完成：${r.ok} 条成功、${r.failed} 条失败（可重跑）`, { id: "kami-backfill" });
      else if (r.ok > 0) toast.success(`补全完成：${r.ok} 条`, { id: "kami-backfill" });
      else toast.info("没有待补的藏品", { id: "kami-backfill" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "补全失败", { id: "kami-backfill" });
    } finally {
      setBusy(false);
    }
  }

  async function chooseFolder() {
    setBusy(true);
    try {
      const handle = await pickDownloadFolder();
      setFolderLabel(handle.name);
      setVaultMirrorFolder(true);
      setDownloadToFolder(true);
      setGranted(true);
      const kept = await requestVaultPersistence();
      setPersisted(kept);
      toast.success(`已选定文件夹「${handle.name}」`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast.error(err instanceof Error ? err.message : "无法选择文件夹");
    } finally {
      setBusy(false);
    }
  }

  async function forgetFolder() {
    await clearFolderHandle();
    setFolderLabel("");
    setGranted(false);
    toast.message("已忘记该文件夹，纸匣仍留在浏览器里");
  }

  function insertToken(token: string) {
    const el = templateRef.current;
    const focused = Boolean(el && typeof document !== "undefined" && document.activeElement === el);
    let start = el?.selectionStart ?? pathTemplate.length;
    let end = el?.selectionEnd ?? start;
    if (!focused) {
      const extAt = pathTemplate.lastIndexOf(".{ext}");
      start = extAt >= 0 ? extAt : pathTemplate.length;
      end = start;
    }
    const next = `${pathTemplate.slice(0, start)}${token}${pathTemplate.slice(end)}`;
    setPathTemplate(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + token.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  const preview = formatDownloadPath(pathTemplate, SAMPLE_PATH_CONTEXT);

  // 备份提醒（M5）：分区每次打开都重挂载，取挂载时刻判定即可，不做定时器。
  // 从未备份（null）不算超期，只给一行小字；口径见 backup-reminder.ts。
  const backupOverdue = isBackupOverdue(lastBackupAt, Date.now());

  return (
    // 存储分区三张卡：主卡（文件夹/规则）+ 画师名称整理 + 标签整理（元数据层，不动文件）
    <>
    <Card>
      <CardHeader>
        <CardTitle>存储</CardTitle>
        <CardDescription>
          Chrome / Edge 请指定一个文件夹，原图留在原地。纸匣只记路径和 SHA-256。Safari、Firefox
          和手机选不了文件夹时，才退到应用内存储。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">

      {backupOverdue ? (
        <div className="flex flex-wrap items-center gap-3">
          {/* .kami-slip 是静态折角笺条（纯 transform 定妆，无动画），不涉 reduced-motion */}
          <span className="kami-slip">距上次备份已超过 30 天</span>
          {/* 分区走 hash 编排：href 改 hash → settings 页 hashchange 监听切分区 */}
          <a href="#backup" className="text-xs text-muted underline underline-offset-4 hover:text-fg">
            去导出一份
          </a>
        </div>
      ) : null}
      {lastBackupAt === null ? (
        <p className="text-xs text-subtle">尚未备份过。换浏览器或清站点数据前，先到「备份」导出一份。</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-bg p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg">
            {folderLabel ? `文件夹 · ${folderLabel}` : "尚未选择文件夹"}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {pickerOk
              ? granted
                ? "写入权限有效。收入纸匣和下载都会按规则放进去。"
                : folderLabel
                  ? "需要再点一次选择，浏览器才会重新授权。"
                  : "选择后可以按作者、日期等规则建子文件夹。"
              : "当前窗口不能选文件夹。用本机 Chrome 或 Edge 打开后即可。"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy || !pickerOk} onClick={() => void chooseFolder()}>
            <FolderOpen className="size-4" />
            {folderLabel ? "更换文件夹" : "选择文件夹"}
          </Button>
          {folderLabel ? (
            <Button type="button" variant="ghost" onClick={() => void forgetFolder()}>
              <FolderX className="size-4" />
              清除
            </Button>
          ) : null}
          {folderLabel && granted ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void rescanFolderHashes()
                  .then((r) => {
                    toast.success(
                      r.replaced
                        ? `已扫描 ${r.checked} 张，${r.replaced} 张原图已被替换`
                        : `已扫描 ${r.checked} 张，原图一致`,
                    );
                  })
                  .catch((err: unknown) => {
                    toast.error(err instanceof Error ? err.message : "扫描失败");
                  })
                  .finally(() => setBusy(false));
              }}
            >
              扫描原图
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-bg p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg">补全档案</p>
          <p className="mt-0.5 text-xs text-muted">
            {backfillCount === null
              ? "正在读取纸匣…"
              : backfillCount > 0
                ? `${backfillCount} 件藏品还缺 AI / R-18 标记，补全后筛选笺对它们生效。逐条拉详情、可随时取消。`
                : "全部藏品都有 AI / R-18 标记，不用补。"}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={backfillCount === 0}
          onClick={() => void runBackfill()}
        >
          <DatabaseZap className="size-4" />
          {busy ? "取消补全" : "补全档案"}
        </Button>
      </div>

      {folderLabel ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">收入纸匣时写入文件夹</p>
              <p className="text-xs text-muted">浏览页点「保存」也会按规则拷一份到磁盘。</p>
            </div>
            <Switch checked={vaultMirrorFolder} onCheckedChange={setVaultMirrorFolder} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">下载写入该文件夹</p>
              <p className="text-xs text-muted">打开后不再丢到浏览器默认下载目录。</p>
            </div>
            <Switch checked={downloadToFolder} onCheckedChange={setDownloadToFolder} />
          </div>
        </div>
      ) : null}

      <div>
        <h3 className="text-sm font-medium">分类规则</h3>
        <p className="mt-1 text-xs text-muted">决定子文件夹和文件名。浏览器下载会把斜杠收成下划线。</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PATH_PRESETS.map((item) => {
            const active = pathPreset === item.id;
            return (
              <button
                key={item.id}
                type="button"
                title={item.hint}
                onClick={() => setPathPreset(item.id)}
                className={cn(
                  "h-10 rounded-full px-3.5 text-sm transition-colors",
                  active ? "bg-accent text-accent-fg" : "bg-bg text-muted hover:text-fg",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <Input
          ref={templateRef}
          className="mt-2 bg-bg font-mono text-xs"
          value={pathTemplate}
          spellCheck={false}
          onChange={(e) => setPathTemplate(e.target.value)}
          aria-label="分类规则"
        />
        <div className="mt-2 flex flex-wrap gap-1">
          {PATH_TOKEN_HELP.map((token) => (
            <button
              key={token}
              type="button"
              className="h-8 rounded-full bg-bg px-2.5 font-mono text-xs text-muted transition-colors hover:text-fg"
              onClick={() => insertToken(token)}
            >
              {token}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-subtle">
          示例：<span className="font-mono text-muted">{preview}</span>
        </p>
      </div>

      <p className="text-xs text-subtle">
        {serverLine ? `${serverLine}。` : "Node 目录暂时不可用，只写浏览器。"}
        浏览器纸匣{persisted ? "已申请持久化" : "会尽量保留"}
        {usage ? ` · 已用 ${usage}` : ""}。
      </p>
      </CardContent>
    </Card>
    <AuthorTidyCard />
    <TagTidyCard />
    </>
  );
}
