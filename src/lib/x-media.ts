/**
 * X 预览页（/x/{handle}）的纯函数与常量（X 账号关联 M6，R4）。
 *
 * 作用：react-query 键工厂（防 #204 换号旧缓存）、查询 staleTime（R6 无自动
 *       轮询）、「去设置填 Cookie」引导的错误文案判定（AC3）、xAssociations
 *       反查关联画师（顶栏「回画师页」链接）。
 * 为什么独立成文件：键工厂要被页面与守卫测试共用（键漏维度 = 旧缓存命中，
 *       #204 教训单测锁住）；反查判据必须与 x-link-card 的「仅忽略记录」口径
 *       一字不差（M5 头注释约定：所有读取处沿用同一判据），集中一处防漂。
 * 不 import upstream/x.ts：那是服务端适配器（http.ts 带 node 依赖），本文件
 *       在客户端组件里跑。
 */
import type { XAssociation } from "./types.ts";

/** X 时间线查询 staleTime：10 分钟（design §4.3）。手动触发、无自动轮询（R6）。 */
export const X_MEDIA_STALE_MS = 10 * 60 * 1000;

/**
 * 预览页 react-query infinite 键。
 * credentialTag 必须进键（#204 教训）：时间线是账号视角数据，换 Cookie / 换号
 * 后旧缓存不得命中。handle 小写归一（X 的 screen_name 大小写不敏感，两条仅
 * 大小写不同的路径应共享缓存分桶）。cursor 不进键——infinite query 的
 * pageParams 自带分页维度。
 */
export function xMediaQueryKey(handle: string, credTag: string) {
  return ["x-media", handle.toLowerCase(), credTag] as const;
}

/**
 * 错误文案 → 是否转「去设置填 / 换 Cookie」引导卡（AC3）。只认 x.ts 产出的
 * 四条用户态文案（requireXSession 两条 + XCookieExpiredError + mapXUserMedia
 * 的空用户判错）；上游 429 / 网络错误不走引导（那是暂态故障，重试即可）。
 */
export function isXCookieGuideMessage(message: string): boolean {
  return /未配置 X Cookie|X Cookie 不完整|X Cookie 已失效|X 用户不存在或 Cookie 已失效/.test(message);
}

/**
 * 反查关联画师：xAssociations 里找「在用关联」指向该 handle / restId 的条目，
 * 命中返回 authorKey（"pixiv:{authorId}"）里的 authorId，供顶栏「回画师页」
 * 链接；查不到返回 undefined（顶栏只显示 handle）。
 *
 * M5 判据（x-link-card 头注释）：handle ∈ 自己的 ignoredHandles 的条目是
 * 「仅忽略记忆」不是在用关联——所有读取处沿用同一判据，别把仅忽略记录当
 * 正式关联。restId 是次级匹配（画师在 X 改名后 handle 对不上仍能反查回）。
 */
export function findXLinkedAuthorId(
  associations: Record<string, XAssociation> | undefined,
  target: { handle: string; restId?: string },
): string | undefined {
  if (!associations) return undefined;
  const handleKey = target.handle.toLowerCase();
  for (const [key, assoc] of Object.entries(associations)) {
    const onlyIgnored = (assoc.ignoredHandles ?? []).some(
      (h) => h.toLowerCase() === assoc.handle.toLowerCase(),
    );
    if (onlyIgnored) continue;
    const handleMatch = assoc.handle.toLowerCase() === handleKey;
    const restIdMatch = Boolean(target.restId && assoc.restId === target.restId);
    if (!handleMatch && !restIdMatch) continue;
    const authorId = key.startsWith("pixiv:") ? key.slice("pixiv:".length) : "";
    if (authorId) return authorId;
  }
  return undefined;
}
