/**
 * 把封面地址升成预览用的稍大图。
 *
 * 作用：悬停放大不要直接拉伸 250px 方图。
 * 用法：upgradeThumbUrl(work.thumb) 给 HoverPreview。
 * 为什么：Pixiv 封面是 /c/250x250/ 的 square1200，拉到 500px 发糊，和旁边那张对不上。
 */
export function upgradeThumbUrl(url: string): string {
  if (!url) return url;
  let next = url;
  next = next.replace(/\/c\/[^/]+\//, "/");
  next = next.replace(/_square1200(\.[a-z0-9]+)/i, "_master1200$1");
  next = next.replace(/_custom1200(\.[a-z0-9]+)/i, "_master1200$1");
  next = next.replace("/preview/", "/sample/");
  return next;
}
