/**
 * 第一次打开的三步向导。
 *
 * 作用：登录 Pixiv → 可选 FANBOX → 可选文件夹。老用户有 Cookie 会自动跳过。
 * 用法：AppShell 里挂一次；点「稍后再说」也算完成，设置里还能再登录。
 */
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FolderOpen, LogIn } from "lucide-react";
import { toast } from "sonner";
import { SessionRelayDialog } from "@/components/session-relay";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { applyLoginSession } from "@/lib/apply-session";
import { canPickFolder, pickDownloadFolder } from "@/lib/folder-access";
import { type LoginSite } from "@/lib/browser-login";
import { useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";

const STEPS = ["Pixiv", "FANBOX", "文件夹"] as const;

export function Onboarding() {
  const navigate = useNavigate();
  const onboarded = useSettings((s) => s.onboarded);
  const pixivCookie = useSettings((s) => s.pixivCookie);
  const fanboxCookie = useSettings((s) => s.fanboxCookie);
  const folderLabel = useSettings((s) => s.folderLabel);
  const setOnboarded = useSettings((s) => s.setOnboarded);
  const setFolderLabel = useSettings((s) => s.setFolderLabel);
  const setVaultMirrorFolder = useSettings((s) => s.setVaultMirrorFolder);
  const setDownloadToFolder = useSettings((s) => s.setDownloadToFolder);
  const [hydrated, setHydrated] = useState(() => useSettings.persist.hasHydrated());
  const [step, setStep] = useState(0);
  const [relay, setRelay] = useState<LoginSite | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (hydrated) return;
    return useSettings.persist.onFinishHydration(() => setHydrated(true));
  }, [hydrated]);

  if (!hydrated || onboarded) return null;

  function finish() {
    setOnboarded(true);
    void navigate({ to: "/" });
  }

  async function afterLogin(data: Parameters<typeof applyLoginSession>[0], next: number) {
    const result = await applyLoginSession(data);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(next === 1 ? "Pixiv 已登录" : "FANBOX 已登录");
    setStep(next);
  }

  async function chooseFolder() {
    if (!canPickFolder()) {
      toast.error("当前浏览器不能选文件夹，可在设置里稍后再选");
      setStep(2);
      return;
    }
    setBusy(true);
    try {
      const handle = await pickDownloadFolder();
      setFolderLabel(handle.name);
      setVaultMirrorFolder(true);
      setDownloadToFolder(true);
      toast.success(`已选择「${handle.name}」`);
      finish();
    } catch {
      toast.error("没有选到文件夹");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) finish(); }}>
        <DialogContent className="max-w-md">
          <DialogTitle>开始使用纸匣</DialogTitle>
          <DialogDescription>
            公开榜单不用登录就能看。登录之后可以推荐、关注、红心，并把喜欢的图收进纸匣。
          </DialogDescription>
          <ol className="flex gap-2 pt-1">
            {STEPS.map((label, i) => (
              <li
                key={label}
                className={cn(
                  "h-8 flex-1 rounded-full text-center text-xs leading-8",
                  i === step ? "bg-accent text-accent-fg" : i < step ? "bg-elevated text-fg" : "bg-elevated text-muted",
                )}
              >
                {label}
              </li>
            ))}
          </ol>
          {step === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                {pixivCookie ? "Pixiv 已经登录，可以下一步。" : "在这个窗口里打开官方登录页，登录成功会把会话带回来。"}
              </p>
              <div className="flex flex-wrap gap-2">
                {pixivCookie ? (
                  <Button onClick={() => setStep(1)}>下一步</Button>
                ) : (
                  <Button onClick={() => setRelay("pixiv")}>
                    <LogIn className="size-4" />
                    登录 Pixiv
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setStep(1)}>
                  跳过
                </Button>
              </div>
            </div>
          ) : null}
          {step === 1 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                {fanboxCookie
                  ? "FANBOX 会话已就绪。"
                  : "Pixiv 登录通常也能打开公开的 FANBOX。订阅内容需要再走一次 FANBOX 登录。"}
              </p>
              <div className="flex flex-wrap gap-2">
                {fanboxCookie ? (
                  <Button onClick={() => setStep(2)}>下一步</Button>
                ) : (
                  <Button onClick={() => setRelay("fanbox")}>
                    <LogIn className="size-4" />
                    登录 FANBOX
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setStep(2)}>
                  跳过
                </Button>
              </div>
            </div>
          ) : null}
          {step === 2 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                {folderLabel
                  ? `当前文件夹是「${folderLabel}」。`
                  : "可选。选一个本机文件夹后，收入纸匣的同时会按路径模板镜像一份。"}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void chooseFolder()}>
                  <FolderOpen className="size-4" />
                  {folderLabel ? "重选文件夹" : "选择文件夹"}
                </Button>
                <Button variant="secondary" onClick={finish}>
                  开始浏览
                </Button>
              </div>
            </div>
          ) : null}
          <button type="button" className="text-xs text-subtle hover:text-muted" onClick={finish}>
            稍后再说
          </button>
        </DialogContent>
      </Dialog>
      <SessionRelayDialog
        site={relay}
        open={Boolean(relay)}
        onOpenChange={(open) => {
          if (!open) setRelay(null);
        }}
        onDone={async (data) => {
          await afterLogin(data, relay === "pixiv" ? 1 : 2);
        }}
      />
    </>
  );
}
