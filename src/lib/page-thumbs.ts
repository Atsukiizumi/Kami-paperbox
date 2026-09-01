/**
 * 从封面 URL 推多页缩略图。
 *
 * 作用：卡片上划前几页，不必先打开作品。
 * 用法：pageThumbUrls(thumb, pageCount)。
 * 为什么：Pixiv 列表只给 p0。同套图 p1/p2 只是把 `_p0_` 换成 `_pN_`。
 */
export function pageThumbUrls(thumb: string, pageCount: number, max = 4): string[] {
  if (!thumb) return [];
  const n = Math.min(Math.max(1, pageCount || 1), max);
  const urls = [thumb];
  if (n < 2) return urls;
  if (!/_p0(?=[._])/i.test(thumb)) return urls;
  for (let i = 1; i < n; i += 1) {
    urls.push(thumb.replace(/_p0(?=[._])/i, `_p${i}`));
  }
  return urls;
}
