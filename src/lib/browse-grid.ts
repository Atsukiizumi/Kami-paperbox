/**
 * 浏览网格该不该画骨架。
 *
 * 作用：当前这一页还没有卡片、列表却还在拉取（含翻页去要下一页）时返回 true。
 * 用法：browse 页用它决定骨架和「正在加载作品」，不要在这个状态下画空纸。
 * 为什么：翻到还没回来的一页时，卡片数是 0，但那不是「没有符合条件的作品」。
 *        这一页已经有卡片时，后台再拉下一页也不换成骨架。
 */
export function browseGridLoading(input: {
  settingsReady: boolean;
  refreshing: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  itemCount: number;
}): boolean {
  const pageEmpty = input.itemCount === 0;
  return (
    !input.settingsReady ||
    input.refreshing ||
    input.isLoading ||
    (pageEmpty && (input.isFetching || input.isFetchingNextPage))
  );
}
