"use client";

/**
 * 设置「浏览」页。
 *
 * 作用：每站点 R-18、过滤 AI 作画（Pixiv）、保存原图、队列并发四个浏览侧开关。
 * 用法：设置分类「浏览」渲染 BrowseSection；直接订阅 settings store。
 * 为什么：R-18 按站点各管各的——浏览页右上角开关读写当前站点这一份，这里总览五站；
 *        过滤 AI 只有 Pixiv 有这个概念（aiType），所以挂在 Pixiv 名下。
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/lib/store";
import { SITE_LIST } from "@/lib/sites";

export function BrowseSection() {
  const safeModeBySite = useSettings((s) => s.safeModeBySite);
  const hideAi = useSettings((s) => s.hideAi);
  const downloadOriginal = useSettings((s) => s.downloadOriginal);
  const setSafeModeFor = useSettings((s) => s.setSafeModeFor);
  const setHideAi = useSettings((s) => s.setHideAi);
  const setDownloadOriginal = useSettings((s) => s.setDownloadOriginal);
  const queueConcurrency = useSettings((s) => s.queueConcurrency);
  const setQueueConcurrency = useSettings((s) => s.setQueueConcurrency);
  return (
    <Card>
      <CardHeader>
        <CardTitle>浏览选项</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">R-18 内容（按站点）</p>
            <p className="text-xs text-muted">
              逐站点控制是否显示成人向作品；浏览页右上角的开关跟随当前站点。涉及未成年人的内容始终过滤。
            </p>
          </div>
          {SITE_LIST.map((site) => (
            <div
              key={site.id}
              className="flex items-center justify-between gap-4 rounded-lg bg-elevated/60 px-3 py-2"
            >
              <p className="text-sm text-fg">{site.label}</p>
              <Switch
                checked={!safeModeBySite[site.id]}
                onCheckedChange={(on) => setSafeModeFor(site.id, !on)}
                aria-label={`${site.label} R-18`}
              />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">过滤 AI 作画（Pixiv）</p>
            <p className="text-xs text-muted">打开后隐藏 Pixiv 标记为 AI 生成的作品。关闭时卡片会打 AI 标签。</p>
          </div>
          <Switch checked={hideAi} onCheckedChange={setHideAi} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">保存原图 / 高清 GIF</p>
            <p className="text-xs text-muted">动图会合成 GIF。关闭则用较小尺寸，速度更快。</p>
          </div>
          <Switch checked={downloadOriginal} onCheckedChange={setDownloadOriginal} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">队列并发数</p>
            <p className="text-xs text-muted">同时处理的下载条目。调高更快，但同一图站压力更大、也更容易触发风控。</p>
          </div>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4].map((n) => (
              <Button
                key={n}
                type="button"
                size="icon"
                variant={queueConcurrency === n ? "default" : "ghost"}
                aria-label={`并发 ${n}`}
                onClick={() => setQueueConcurrency(n)}
                className="size-8 text-xs tabular-nums"
              >
                {n}
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
