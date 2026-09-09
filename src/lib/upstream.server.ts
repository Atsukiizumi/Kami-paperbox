/**
 * 上游层门面（TD-01 拆分后的桶）。
 *
 * 实现按站点分在 src/lib/upstream/：pixiv / fanbox / booru-sites / media /
 * dispatch / http（共享）。这里只保留原导出，@/lib/upstream.server 的
 * 既有导入方零改动；新代码建议直接 import 具体模块。
 */
export { dispatchFetch } from "./upstream/dispatch.ts";
export { fetchMediaResponse, parseAllowedMediaUrl } from "./upstream/media.ts";
