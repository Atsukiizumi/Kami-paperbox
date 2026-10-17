"use client";

/**
 * 设置「X（Twitter）」卡（X 账号关联，M4）。
 *
 * 作用：X Cookie 输入（auth_token + ct0，浏览画师媒体时间线用）与 GraphQL
 *      queryId 覆盖折叠区（X 前端发版轮换 queryId 后预览失效时手工补）。
 * 用法：AccountsPartition 末尾渲染；直接订阅 settings store，不经设置页下传
 *      （与 Danbooru 账号卡同款）。xCookie 写进当前账号，随账号切换。
 * 为什么独立卡不进登录中转：X 无浏览器代登（不做账号密码），且图片下载免登录
 *      （pbs.twimg.com）——Cookie 只服务时间线接口，与 Pixiv/FANBOX 代登框分开。
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/lib/store";
import { sanitizeXCookie, X_DEFAULT_QUERY_IDS } from "@/lib/x-settings";
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
  // 中间态（只粘到一半）不算错——只提示，不拦截输入；清洗发生在保存/请求边界
  const incomplete = xCookie.trim() !== "" && !sanitizeXCookie(xCookie);

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
            在 x.com 登录后，从浏览器 DevTools → 网络 → 任意请求的 Cookie 头里复制
            <span className="text-fg"> auth_token </span>与<span className="text-fg"> ct0 </span>
            两段（整段头粘贴也行，会自动只留这两项）。只存在这台设备。
          </p>
          {incomplete ? (
            <p className="text-xs text-red-500">需要同时带 auth_token 与 ct0 两个字段，现在缺了一个。</p>
          ) : null}
        </div>
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
    </Card>
  );
}
