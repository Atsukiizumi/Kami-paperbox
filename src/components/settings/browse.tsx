"use client";

/**
 * 设置「浏览」页。
 *
 * 作用：R-18、过滤 AI 作画、保存原图、队列并发四个浏览侧开关。
 * 用法：设置分类「浏览」渲染 BrowseSection；直接订阅 settings store。
 * 为什么：这些开关只服务本分区，不与设置页其他部分共享，分区自取即可。
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/lib/store";

export function BrowseSection() {
  const safeMode = useSettings((s) => s.safeMode);
  const hideAi = useSettings((s) => s.hideAi);
  const downloadOriginal = useSettings((s) => s.downloadOriginal);
  const setSafeMode = useSettings((s) => s.setSafeMode);
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
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">R-18 内容</p>
            <p className="text-xs text-muted">默认关闭。打开后显示成人向作品。涉及未成年人的内容始终过滤。</p>
          </div>
          <Switch checked={!safeMode} onCheckedChange={(on) => setSafeMode(!on)} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">过滤 AI 作画</p>
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
