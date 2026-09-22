/**
 * Pixiv 动图 → GIF。
 *
 * 作用：按 ugoira_meta 的帧延时把 zip 里的图编成 GIF。
 * 用法：encodeUgoiraGif(zipBytes, meta)；播放器用 UgoiraPlayer。
 * 为什么：浏览器不能直接播 ugoira zip，存进纸匣也需要单一文件。
 */
import { GIFEncoder, applyPalette, quantize } from "gifenc/dist/gifenc.esm.js";

/**
 * 双作用域画布（F1，第三波审查热修）：Worker 里没有 document（DOM 不进
 * worker），动图合成必须走 OffscreenCanvas 才能真出主线程；主线程保持原
 * canvas 路径。两个 ctx 的 drawImage/getImageData 成员同形，TS 以联合类型表达。
 */
export function createCanvas2D(
  width: number,
  height: number,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  if (typeof document === "undefined") {
    if (typeof OffscreenCanvas === "undefined") throw new Error("无可用画布（既无 document 也无 OffscreenCanvas）");
    const off = new OffscreenCanvas(width, height);
    const ctx = off.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("无法创建画布");
    return ctx as OffscreenCanvasRenderingContext2D;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法创建画布");
  return ctx;
}

export async function encodeUgoiraGif(
  frames: { delay: number; bytes: Uint8Array }[],
  opts: { maxEdge: number; onProgress?: (done: number, total: number) => void },
): Promise<Blob> {
  if (frames.length === 0) throw new Error("没有可编码的帧");
  const probe = await decodeFrame(frames[0].bytes);
  const scale = Math.min(1, opts.maxEdge / Math.max(probe.width, probe.height));
  const width = Math.max(1, Math.round(probe.width * scale));
  const height = Math.max(1, Math.round(probe.height * scale));
  probe.close();

  const ctx = createCanvas2D(width, height);

  const gif = GIFEncoder();
  for (let i = 0; i < frames.length; i += 1) {
    const bmp = await decodeFrame(frames[i].bytes);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bmp, 0, 0, width, height);
    bmp.close();
    const { data } = ctx.getImageData(0, 0, width, height);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, width, height, {
      palette,
      delay: frames[i].delay,
      repeat: i === 0 ? 0 : undefined,
    });
    opts.onProgress?.(i + 1, frames.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  gif.finish();
  const bytes = gif.bytes();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "image/gif" });
}

async function decodeFrame(bytes: Uint8Array): Promise<ImageBitmap> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return createImageBitmap(new Blob([copy]));
}
