"use client";

/**
 * 应用账号的邮箱密码表单（登录 / 注册）。
 *
 * 作用：一套登录逻辑两处用——顶栏右上角的登录弹窗和设置页的应用账号卡片。
 * 用法：<AppAccountSignInForm onDone={() => setOpen(false)} />。
 * 为什么：各写一份迟早漂移；登录瞬间派生同步 KEK 这步丢了，设置段就会退化成
 *        省略凭据形态推上服务端，换设备恢复时 Cookie 就没了。
 */
import { LogIn } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ensureSyncKek } from "@/lib/sync/account-sync";
import { authClient } from "@/lib/auth/client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function AppAccountSignInForm({ onDone }: { onDone?: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(mode: "in" | "up") {
    setError("");
    if (!email.trim() || !password) {
      setError("邮箱和密码都要填");
      return;
    }
    setBusy(true);
    try {
      const res =
        mode === "up"
          ? await authClient.signUp.email({ email: email.trim(), password, name: email.trim().split("@")[0] })
          : await authClient.signIn.email({ email: email.trim(), password });
      if (res.error) {
        setError(res.error.message || (mode === "up" ? "注册失败" : "登录失败"));
        return;
      }
      // 密码在手的一瞬派生同步密钥（KEK，sessionStorage）——失败不拦登录，
      // 只是设置段暂以省略凭据形态同步。
      await ensureSyncKek(password).catch(() => false);
      setPassword("");
      toast.success(mode === "up" ? "已注册并登录" : "已登录");
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="app-account-email">邮箱</Label>
          <Input
            id="app-account-email"
            type="email"
            autoComplete="username"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div>
          <Label htmlFor="app-account-password">密码</Label>
          <Input
            id="app-account-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 8 位"
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit("in");
            }}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => void submit("in")}>
          <LogIn className="size-3.5" />
          登录
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void submit("up")}>
          注册
        </Button>
      </div>
      <p className="text-xs text-subtle">
        首次使用先注册一个。忘记密码没有找回通道——账号只存本机，忘了就重新注册再「从服务端恢复」绑定新账号。
      </p>
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
    </div>
  );
}
