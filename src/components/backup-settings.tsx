/**
 * 设置「备份」页。
 *
 * 作用：导出一份 JSON（设置、账号、纸匣目录、词表、历史），再从文件读回来。
 * 用法：设置分类里打开。导入会覆盖设置和账号，纸匣记录按编号合并。
 */
import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { applyBackupFile, downloadBackup } from "@/lib/backup-client";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

export function BackupSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function exportBackup() {
    setBusy(true);
    try {
      const result = await downloadBackup();
      toast.success(`已导出 ${result.accounts} 个账号、${result.vault} 条纸匣记录`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败");
    } finally {
      setBusy(false);
    }
  }

  async function importBackup(file: File) {
    const ok = window.confirm("导入会覆盖当前设置和账号，纸匣记录按编号合并。文件里有登录会话，只应在你自己的电脑上打开。继续？");
    if (!ok) return;
    setBusy(true);
    try {
      const result = await applyBackupFile(file);
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
            文件留在你自己的电脑上。不要发到网上，也不要放进仓库。用户文件夹的授权导不走，导入后到「存储」重新选一次即可。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
