/**
 * 凭据指纹（SEC-04）。
 *
 * 作用：react-query 的 queryKey 需要区分「登录身份」，此前直接放 Cookie
 *      原文——而 queryKey 会随 browse-cache 脱水进 localStorage，等于把
 *      Pixiv / FANBOX 会话明文存在第二个清不掉的落点。
 * 用法：queryKey 里放 credentialTag(cookie)；空串保持空串（未登录态的
 *      key 不变，旧缓存语义延续）。
 * 为什么：FNV-1a 同步、够快（queryKey 不能等 async 的 WebCrypto）；
 *      指纹只用于缓存分桶，碰撞概率 2^-32 对此用途可忽略，且不含原文
 *      任何可逆信息。
 */

/** 32 位 FNV-1a，输出 8 位十六进制；空输入给空串。 */
export function credentialTag(value: string | undefined | null): string {
  if (!value) return "";
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
