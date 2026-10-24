"use client";

/**
 * 设置「X（Twitter）」卡（X 账号关联，M4；中转登录，10-18）。
 *
 * 作用：X Cookie 获取双路径——「中转登录」（后端 Chrome 开 x.com 官方登录页，
 *      画面/输入中转，CDP 自动收 auth_token/ct0，与 Pixiv/FANBOX 同款）与
 *      手动粘贴框（中转被拦时的兜底）；GraphQL queryId 覆盖折叠区。
 * 用法：AccountsPartition 末尾渲染；直接订阅 settings store，不经设置页下传
 *      （与 Danbooru 账号卡同款）。xCookie 写进当前账号，随账号切换。
 * 为什么对话框挂本卡不挂设置页：X 入口与设置页级的 relaySite（pixiv/fanbox
 *      共用那个）解耦，单 job 互斥由服务端兜底——两处同时开只会有一个跑起来。
 */
import { useState } from "react";
import { PlugZap } from "lucide-react";
import { toast } from "sonner";
import { LogIn } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SessionRelayDialog } from "@/components/session-relay";
import { cookiesFromSettings, useSettings } from "@/lib/store";
import { sanitizeXCookie, X_DEFAULT_QUERY_IDS } from "@/lib/x-settings";
import { applyLoginSession } from "@/lib/sync/apply-session";
import { fetchSource } from "@/lib/source";
import type { XQueryIdKey } from "@/lib/types";

const QUERY_ID_LABELS: Record<XQueryIdKey, string> = {
  userByScreenName: "UserByScreenName",
  userMedia: "UserMedia",
  tweetResult: "TweetResultByRestId",
};

export function XAccountCard() {
  const xCookie = useSettings((s) => s.xCookie);
  const setXCookie = useSettings((s) => s.setXCookie);
  const syncSessions = useSettings((s) => s.syncSessions);
  const queryIds = useSettings((s) => s.xGraphQLQueryIds);
  const setQueryIds = useSettings((s) => s.setXGraphQLQueryIds);
  const [relayOpen, setRelayOpen] = useState(false);
  // 中间态（只粘到一半）不算错——只提示，不拦截输入；清洗发生在保存/请求边界
  const incomplete = xCookie.trim() !== "" && !sanitizeXCookie(xCookie);

  const [testing, setTesting] = useState(false);

  /** 凭据探针（docs/99 问题 1）：把「/x/ 报失效」拆成 凭据失效/网络/未知 三态。 */
  async function runVerify(id = "kami-x-verify") {
    setTesting(true);
    try {
      const r = await fetchSource({ data: { op: "xVerify", ...cookiesFromSettings("x") } });
      if (r.op !== "xVerify") throw new Error("返回异常");
      if (r.ok) toast.success(r.message, { id });
      else if (r.kind === "expired") toast.error(r.message, { id, description: "可重新中转登录，或到 x.com 手贴新 Cookie。" });
      else toast.message(r.message, { id });
      return r.ok;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "测试失败", { id });
      return false;
    } finally {
      setTesting(false);
    }
  }

  async function applyRelay(data: { x?: string }) {
    const result = await applyLoginSession({ ...data });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    // 写入即验证：中转刚收的凭据当场打一枪——「登录完就报失效」当场见分晓。
    const ok = await runVerify("kami-x-relay-verify");
    if (ok) toast.success("X Cookie 已写入并验证通过", { id: "kami-x-written" });
    else toast.message("Cookie 已写入，但验证未通过——详情见上方提示", { id: "kami-x-written" });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>X（Twitter）</CardTitle>
        <CardDescription>
          浏览画师的 X 媒体时间线需要登录 Cookie；图片下载免登录。建议用小号或
          低敏感账号——X 对程序化访问敏感，纸匣已按保守节奏限速，但锁号风险非零。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label htmlFor="x-cookie">X Cookie</Label>
          <Input
            id="x-cookie"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="auth_token=…; ct0=…"
            value={xCookie}
            onChange={(e) => setXCookie(e.target.value.trim())}
            onBlur={() => void syncSessions().catch(() => undefined)}
          />
          <p className="mt-1 text-xs leading-relaxed text-subtle">
            或手动粘贴：在 x.com 登录后，从浏览器 DevTools → 网络 → 任意请求的 Cookie
            头里复制<span className="text-fg"> auth_token </span>与<span className="text-fg"> ct0 </span>
            两段（整段头粘贴也行，会自动只留这两项）。只存在这台设备。
          </p>
          {incomplete ? (
            <p className="text-xs text-red-500">需要同时带 auth_token 与 ct0 两个字段，现在缺了一个。</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setRelayOpen(true)}>
            <LogIn className="size-4" />
            中转登录
          </Button>
          <Button variant="ghost" disabled={testing || xCookie.trim() === ""} onClick={() => void runVerify()}>
            <PlugZap className="size-4" />
            {testing ? "测试中…" : "测试连接"}
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-subtle">
          「中转登录」会在本页里打开 x.com 官方登录页，密码只打在 X 自己的页面上；
          登录完成后纸匣自动收回会话（含可能的验证码 / 2FA，都在中转画面里操作）。
        </p>
        <details className="rounded-lg border border-fg/10 p-3">
          <summary className="cursor-pointer text-sm text-muted">高级：GraphQL queryId 覆盖</summary>
          <p className="mt-2 text-xs leading-relaxed text-subtle">
            X 前端发版会轮换 queryId（数月一次），轮换后 X 预览会失效——到那时才需要
            按 reverse-engineering 文档的方法自取新 ID 填进对应框；平时留空走内置默认。
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {(Object.keys(X_DEFAULT_QUERY_IDS) as XQueryIdKey[]).map((key) => (
              <div key={key}>
                <Label htmlFor={`x-qid-${key}`}>{QUERY_ID_LABELS[key]}</Label>
                <Input
                  id={`x-qid-${key}`}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={X_DEFAULT_QUERY_IDS[key]}
                  value={queryIds[key] ?? ""}
                  onChange={(e) => setQueryIds({ ...queryIds, [key]: e.target.value.trim() })}
                />
              </div>
            ))}
          </div>
        </details>
      </CardContent>
      <SessionRelayDialog
        site="x"
        open={relayOpen}
        onOpenChange={setRelayOpen}
        onDone={applyRelay}
      />
    </Card>
  );
}
