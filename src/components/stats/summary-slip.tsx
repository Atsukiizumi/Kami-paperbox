/**
 * 画像小结语（用户画像分区收尾）。
 *
 * 作用：把 profileSummary 的字段拼成一两句中文——心头好画师 / 高频标签出现率 /
 *      收藏跨度；null 字段的半句直接隐藏，读不出就老实说读不出。
 * 用法：<SummarySlip summary={profileSummary(items)} />。
 * 为什么：措辞留在组件、聚合留在纯函数，两边可以各自单测/改文案；
 *        不编造「风格标签」，只说数据说得出的部分。
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProfileSummary } from "@/lib/storage/vault-profile";

function sentenceOf(summary: ProfileSummary): string {
  const parts: string[] = [];
  if (summary.favoriteAuthor) {
    parts.push(`心头好是「${summary.favoriteAuthor.name}」，已收 ${summary.favoriteAuthor.count} 张`);
  }
  if (summary.topTag) {
    parts.push(`「${summary.topTag.tag}」出现在 ${Math.round(summary.topTag.rate * 100)}% 的藏品上`);
  }
  if (summary.spanDays !== null && summary.spanDays > 0) {
    parts.push(`收藏跨度 ${summary.spanDays.toLocaleString("zh-CN")} 天`);
  }
  if (parts.length === 0) return "藏品还太少，读不出习惯；多收几张，这里会自己长出句子。";
  return `${parts.join("；")}。`;
}

export function SummarySlip({ summary, className }: { summary: ProfileSummary; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>画像小结</CardTitle>
        <CardDescription>综合画师、标签与跨度的读法。</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-fg/90">{sentenceOf(summary)}</p>
      </CardContent>
    </Card>
  );
}
