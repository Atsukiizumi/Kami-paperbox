/**
 * 纸匣页文件的服务端响应头策略（卫生批②）。
 *
 * 作用：GET /api/vault?key&page 出文件字节时，Content-Type 由服务端按
 *      扩展名白名单映射——不回放入库时客户端声明的 MIME（PUT multipart
 *      的 file.type 是请求方可控值，回放等于把渲染语义交给上传方）。
 * 为什么：白名单外的扩展（含 html / svg）按附件下发 + nosniff，任何
 *        浏览器都不会把它当页面渲染；正常媒体（jpg/png/gif/webp/avif/
 *        ugoira zip/短视频）不受影响，仍内联显示。
 */
export const VAULT_PAGE_MIME: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  zip: "application/zip",
  mp4: "video/mp4",
  webm: "video/webm",
};

export function vaultPageHeaders(ext: string): {
  "content-type": string;
  "x-content-type-options": "nosniff";
  "content-disposition"?: string;
  "cache-control": string;
} {
  const known = VAULT_PAGE_MIME[ext.toLowerCase()];
  return {
    "content-type": known ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
    // 白名单外：强制当附件下载，杜绝按文档渲染的任何残余路径
    ...(known ? {} : { "content-disposition": "attachment" }),
    "cache-control": "private, max-age=3600",
  };
}
