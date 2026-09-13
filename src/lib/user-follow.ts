/**
 * 画师关注乐观更新（TD-23 回归防线，M9 RTL）。
 *
 * 作用：把关注/取关的 setQueryData 乐观补丁收敛为纯函数——queryKey 由调用方
 *      传入且与 useQuery 共享同一实例，杜绝「写路径键漂移」。
 * 用法：UserPage 的 onClick 里 applyFollowPatch(queryClient, userQueryKey, on)。
 * 为什么抽出来：key 接线错误只有组件级测试能拦（纯函数测试看不见 wiring）。
 */
import type { QueryClient } from "@tanstack/react-query";

type UserPageData = {
  pages?: { profile?: { isFollowed?: boolean } }[];
};

export function applyFollowPatch(client: QueryClient, queryKey: unknown[], on: boolean): void {
  client.setQueryData<UserPageData>(queryKey, (old) => {
    if (!old || !Array.isArray(old.pages)) return old;
    return {
      ...old,
      pages: old.pages.map((page) => ({
        ...page,
        profile: { ...page.profile, isFollowed: on },
      })),
    };
  });
}
