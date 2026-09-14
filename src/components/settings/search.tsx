"use client";

/**
 * 设置「搜图」页。
 *
 * 作用：SauceNAO API key 与 Danbooru 账号两块表单，各自直连 settings store。
 * 用法：设置分类「搜图」渲染 SearchPartition（两张卡片，顺序与拆分前一致）。
 * 为什么：两个凭据都只存在本机 store，分区自己订阅即可，无需从设置页下传。
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/lib/store";

function DanbooruSection() {
  const login = useSettings((s) => s.danbooruLogin);
  const apiKey = useSettings((s) => s.danbooruApiKey);
  const setDanbooruLogin = useSettings((s) => s.setDanbooruLogin);
  const setDanbooruApiKey = useSettings((s) => s.setDanbooruApiKey);
  const syncSessions = useSettings((s) => s.syncSessions);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Danbooru 账号</CardTitle>
        <CardDescription>
          Danbooru 开了 Cloudflare 人机验证，匿名请求会被 403。填账号后请求带上凭据可以免验证。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="danbooru-login">用户名</Label>
            <Input
              id="danbooru-login"
              autoComplete="off"
              spellCheck={false}
              value={login}
              onChange={(e) => setDanbooruLogin(e.target.value)}
              onBlur={() => void syncSessions().catch(() => undefined)}
              placeholder="Danbooru 用户名"
            />
          </div>
          <div>
            <Label htmlFor="danbooru-key">API key</Label>
            <Input
              id="danbooru-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setDanbooruApiKey(e.target.value)}
              onBlur={() => void syncSessions().catch(() => undefined)}
              placeholder="在 danbooru.donmai.us/settings 复制"
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-subtle">
          去{" "}
          <a
            href="https://danbooru.donmai.us/static/profile"
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
          >
            Danbooru 个人页
          </a>{" "}
          注册后在「API Key」里生成。只存在本机，凭据错误时 Danbooru 榜单仍会 403。
        </p>
      </CardContent>
    </Card>
  );
}

function SearchKeySection() {
  const apiKey = useSettings((s) => s.saucenaoApiKey);
  const setSaucenaoApiKey = useSettings((s) => s.setSaucenaoApiKey);
  return (
    <Card>
      <CardHeader>
        <CardTitle>搜图</CardTitle>
        <CardDescription>
          SauceNAO 匿名每天次数很少，也容易被当成机器人。填 API key 后走官方接口，间隔可以更短。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Label htmlFor="saucenao-key">SauceNAO API key</Label>
        <Input
          id="saucenao-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          onChange={(e) => setSaucenaoApiKey(e.target.value)}
          placeholder="在 saucenao.com/user.php 复制"
        />
        <p className="mt-2 text-xs text-subtle">
          去{" "}
          <a href="https://saucenao.com/user.php" target="_blank" rel="noreferrer" className="hover:underline">
            saucenao.com/user.php
          </a>{" "}
          注册后把 API key 填在这里。没有 key 时 SauceNAO 很容易被风控。
        </p>
      </CardContent>
    </Card>
  );
}

export function SearchPartition() {
  return (
    <>
      <SearchKeySection />
      <DanbooruSection />
    </>
  );
}
