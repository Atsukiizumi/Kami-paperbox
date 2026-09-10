/**
 * 设置「备份」页。
 *
 * 作用：导出一份 JSON（设置、账号、纸匣目录、词表、历史），再从文件读回来。
 * 用法：设置分类里打开。导入会覆盖设置和账号，纸匣记录按编号合并。
 */
import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { applyBackupFile, backupNeedsPassphrase, downloadBackup } from "@/lib/backup-client";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

export function BackupSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // 导出口令：留空导出明文 v1；填了出 v2 加密文件（设置与代理地址整段密文）
  const [exportPass, setExportPass] = useState("");

  async function exportBackup() {
    setBusy(true);
    try {
      const passphrase = exportPass.trim();
      const result = await downloadBackup(passphrase || undefined);
      toast.success(
        passphrase
          ? `已导出加密备份（${result.accounts} 个账号、${result.vault} 条纸匣记录）。口令丢了文件就读不回来了，请记牢。`
          : `已导出 ${result.accounts} 个账号、${result.vault} 条纸匣记录`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败");
    } finally {
      setBusy(false);
    }
  }

  async function importBackup(file: File) {
    let passphrase: string | undefined;
    // 加密文件先问口令（v1 明文直接走）
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      if (backupNeedsPassphrase(raw)) {
        const input = window.prompt("这份备份用了口令加密，请输入口令：");
        if (input === null) return;
        passphrase = input;
      }
    } catch {
      toast.error("不是 JSON");
      return;
    }
    const ok = window.confirm("导入会覆盖当前设置和账号，纸匣记录按编号合并。继续？");
    if (!ok) return;
    setBusy(true);
    try {
      const result = await applyBackupFile(file, passphrase);
      toast.success(`已导入 ${result.accounts} 个账号、${result.vault} 条纸匣记录。若用了文件夹，请到「存储」里再选一次。`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>导出 / 导入</CardTitle>
          <CardDescription>
            把本机设置、账号登录、纸匣目录、词表译文和浏览历史存成一份 JSON。换浏览器或清站点数据之前先导出。原图像素仍在你选的文件夹和应用内备份目录里，这份文件只记目录，不打包图片。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid max-w-sm gap-1.5">
            <Input
              type="password"
              value={exportPass}
              onChange={(e) => setExportPass(e.target.value)}
              placeholder="导出口令（可选）：填写后设置与登录凭据加密保存"
              autoComplete="new-password"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => void exportBackup()}>
              <Download className="size-4" />
              导出备份
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" />
              导入备份
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importBackup(file);
              }}
            />
          </div>
          <p className="text-xs leading-relaxed text-subtle">
            文件留在你自己的电脑上。不要发到网上，也不要放进仓库。填了口令的备份要外发也相对安全（登录凭据与代理地址是密文），但口令丢了就读不回来；不填则和从前一样是明文。用户文件夹的授权导不走，导入后到「存储」重新选一次即可。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
