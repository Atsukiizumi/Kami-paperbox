/**
 * 原图指纹。
 *
 * 作用：纸匣只记路径和 SHA-256，扫描时对比文件有没有被换掉。
 * 用法：sha256Hex(blob)。
 */
export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
