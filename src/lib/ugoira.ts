import { GIFEncoder, applyPalette, quantize } from "gifenc/dist/gifenc.esm.js";
import { unzipUgoira } from "./ugoira-zip";

export { unzipUgoira } from "./ugoira-zip";

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

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法创建画布");

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
