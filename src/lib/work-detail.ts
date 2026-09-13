/**
 * 作品详情的查询键 / 拉取 / 预取（浏览器侧）。
 *
 * 作用：详情页和浏览卡片悬停共用同一份 react-query 键与请求，悬停即预热，
 *       点开详情直接命中缓存。
 * 用法：详情页 useQuery(workDetailOptions(src, id))；卡片 onMouseEnter 调
 *       prefetchWork(queryClient, source, id)。
 * 为什么：键里带 safeMode 和凭据指纹，两处各写一份迟早对不上，缓存就永远
 *        命中不了——集中在这一处，换键时只改一个地方。
 */
import type { QueryClient } from "@tanstack/react-query";
import { credentialTag } from "./sync/cred-tag";
import { fanboxSessionFrom } from "./sync/browser-login";
import { loadWork } from "./queue-runner";
import { useSettings } from "./store";
import type { Source, WorkDetail } from "./types";

export function workDetailQueryKey(src: Source, id: string) {
  const s = useSettings.getState();
  const fanboxCookie = fanboxSessionFrom(s.fanboxCookie, s.pixivCookie);
  return ["work", src, id, s.safeMode, credentialTag(s.pixivCookie), credentialTag(fanboxCookie)] as const;
}

/** 详情页与悬停预取共用的拉取（就是队列保存用的那份 loadWork）。 */
export const fetchWorkDetail = loadWork;

/** 卡片悬停时预取详情（30 秒内点开不再打服务端）。失败静默——点开时详情页自己会重试并报错。 */
export function prefetchWork(queryClient: QueryClient, src: Source, id: string) {
  void queryClient.prefetchQuery({
    queryKey: workDetailQueryKey(src, id),
    queryFn: () => fetchWorkDetail(src, id),
    staleTime: 30_000,
  });
}
