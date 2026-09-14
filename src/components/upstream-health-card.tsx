"use client";

/**
 * 上游健康卡片（M2 可观测性）。
 *
 * 作用：设置页「帮助」分区展示本机服务出站到各图站的最近状态——每站
 *      调用数 / 成功率 / p50 延迟 / 最近一次失败及距今时长，30 秒轮询。
 * 用法：<UpstreamHealthCard />，数据来自 GET /api/health/upstream
 *      （会话闸，guest 不放行；未登录看到的是 401，卡片只显示读不到）。
 * 为什么：报障前先看这里就知道是哪个站慢了/挂了还是本机代理问题。纯内存
 *      环，重启清零；无动画（reduced-motion 下天然安全），纸感走既有
 *      Card 与墨色 token，不引入新样式。
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type UpstreamHostHealth = {
  host: string;
  calls: number;
  okRate: number;
  p50Ms: number;
  lastError: string | null;
  lastErrorAt: number | null;
};

const POLL_INTERVAL_MS = 30_000;

function relativeTime(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "刚刚";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function okRateLabel(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function UpstreamHealthCard() {
  // hosts: null = 还没拿到首帧数据；failed = 最近一次轮询失败（401/网络）。
  const [hosts, setHosts] = useState<UpstreamHostHealth[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/health/upstream");
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { hosts?: UpstreamHostHealth[] };
        if (cancelled) return;
        setHosts(data.hosts ?? []);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>上游健康</CardTitle>
        <CardDescription>
          本机服务出站到各图站的最近 50 次请求统计。只记在内存里，重启服务后清零。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hosts === null && !failed ? <p className="text-sm text-muted">正在读取…</p> : null}
        {failed ? <p className="text-sm text-muted">暂时读不到健康数据（服务未响应或未登录）。</p> : null}
        {hosts !== null && !failed && hosts.length === 0 ? (
          <p className="text-sm text-muted">暂无上游请求记录。浏览或下载一次作品后再回来看。</p>
        ) : null}
        {hosts !== null && !failed && hosts.length > 0 ? (
          <ul className="space-y-2">
            {hosts.map((item) => (
              <li key={item.host} className="rounded-lg border border-fg/10 px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="min-w-0 truncate text-sm text-fg">{item.host}</span>
                  <span className="text-xs text-subtle tabular-nums">
                    成功率 {okRateLabel(item.okRate)} · p50 {item.p50Ms} ms · 共 {item.calls} 次
                  </span>
                </div>
                {item.lastError && item.lastErrorAt ? (
                  <p className="mt-0.5 truncate text-xs text-red-500/90">
                    最近失败 {item.lastError}（{relativeTime(item.lastErrorAt)}）
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
