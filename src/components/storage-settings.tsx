import { FolderOpen, FolderX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  formatDownloadPath,
  PATH_PRESETS,
  PATH_TOKEN_HELP,
  SAMPLE_PATH_CONTEXT,
} from "@/lib/download-path";
import {
  canPickFolder,
  clearFolderHandle,
  folderPermissionState,
  pickDownloadFolder,
} from "@/lib/folder-access";
import { useSettings } from "@/lib/store";
import { cn, formatBytes } from "@/lib/utils";
import { requestVaultPersistence, vaultStorageEstimate } from "@/lib/vault";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";

export function StorageSection() {
  const folderLabel = useSettings((s) => s.folderLabel);
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
  }

  useEffect(() => {
    setPickerOk(canPickFolder());
    void requestVaultPersistence().then((ok) => setPersisted(ok));
    void refreshStatus();
  }, []);

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

  return (
    <section className="space-y-4 rounded-xl bg-surface p-5">
      <div>
        <h2 className="text-sm font-medium">存储</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          纸匣默认存在这台设备的浏览器里，关页再开还在。想同时落到磁盘上，就选一个文件夹，并指定分类规则。
        </p>
      </div>

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
        </div>
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
        浏览器纸匣{persisted ? "已申请持久化" : "会尽量保留"}
        {usage ? ` · 已用 ${usage}` : ""}。清站点数据仍会丢掉浏览器里的一份。
      </p>
    </section>
  );
}
