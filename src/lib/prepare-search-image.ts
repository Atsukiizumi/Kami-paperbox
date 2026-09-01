/**
 * 搜图前把原图收成小 JPEG。
 *
 * 作用：最长边 768px，体积大约压到 700 KB 以内。
 * 用法：浏览器里 await prepareSearchImage(file)，再 POST /api/reverse-search。
 * 为什么：SauceNAO / ascii2d 看的是画面特征，不需要原图像素。大图上传又慢
 *        又像爬虫，更容易撞验证码。
 */
const MAX_EDGE = 768;
const SKIP_UNDER = 250_000;

export async function prepareSearchImage(file: File): Promise<File> {
  if (typeof createImageBitmap !== "function") return file;
  if (file.size <= SKIP_UNDER && /jpe?g/i.test(file.type || file.name)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const edge = Math.max(bitmap.width, bitmap.height);
    const scale = edge > MAX_EDGE ? MAX_EDGE / edge : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    if (!blob || blob.size === 0) return file;
    if (blob.size >= file.size && file.size <= 800_000) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
