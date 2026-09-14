"use client";

/**
 * 设置「说明」页。
 *
 * 作用：使用说明、Cookie 复制步骤、灯箱操作说明，外加上游健康卡片。
 * 用法：设置分类「说明」渲染 HelpPartition；UpstreamHealthCard 自己轮询。
 * 为什么：纯静态说明文案集中一处，健康卡片的接线（P2 合入）原样保留。
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UpstreamHealthCard } from "@/components/upstream-health-card";

export function HelpPartition() {
  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>使用说明</CardTitle>
          <CardDescription>
            公开榜单、Yande / Konachan / Danbooru 不需要登录。备份 Pixiv 收藏、R-18 或已订阅的 FANBOX 时，填入自己的会话 Cookie。Pixiv 动图可播放并保存为 GIF。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-muted">
            请尊重作者版权，不要转载或商用。只保存你已经有权查看的内容。
          </p>
        </CardContent>
      </Card>

      <section className="space-y-2 text-sm text-muted">
        <h2 className="text-sm font-medium text-fg">怎样复制 Cookie</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>在电脑浏览器登录 pixiv.net 或 fanbox.cc。</li>
          <li>打开开发者工具 → Application / 存储 → Cookies。</li>
          <li>复制 PHPSESSID 或 FANBOXSESSID 的值，粘贴到当前账号。也可以整段 Cookie 头、Cookie-Editor JSON 或 cookies.txt。</li>
          <li>Pixiv 已登录的 PHPSESSID 形如 12345678_后面一串，没有下划线的是访客 Cookie，不能用。</li>
          <li>Cookie 只存在你的浏览器里，不会进数据库。</li>
        </ol>
      </section>

      <section className="space-y-2 text-sm text-muted">
        <h2 className="text-sm font-medium text-fg">大图浏览（灯箱）</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>点开作品大图进入灯箱：滚轮或双指捏合缩放（以光标 / 双指中点为锚），放大后按住拖动看细节，双击在原大与 2× 间切换。</li>
          <li>键盘 ← / → 翻页，+ / − 缩放，0 复位，Esc 关闭。</li>
          <li>多 P 作品在卡片上的大预览浮层里，滚轮是翻页；要缩放请点进灯箱——两处滚轮各司其职。</li>
        </ul>
      </section>

      <UpstreamHealthCard />
    </div>
  );
}
