/**
 * dHash 感知哈希（纸匣查重用）。
 *
 * 作用：64-bit 差值哈希 + 汉明距离——同图不同尺寸/来源距离小，异图距离大。
 * 用法：dhashFromBytes(收藏第一页文件, mime)；hammingHex 比对（阈值 ≤10 视为候选）。
 * 为什么 dHash 而不是字节哈希：重编码/缩放后字节全变，查不了「同图不同源」。
 */
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

/** 9×8 灰度 → 横向差分 → 64 bit → 16 位 hex。RGBA 输入任意尺寸（盒式降采样）。 */
export function dhashFromRgba(width: number, height: number, rgba: Uint8Array): string {
  const gw = 9;
  const gh = 8;
  const gray = new Float64Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    const y0 = Math.floor((gy * height) / gh);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / gh));
    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.floor((gx * width) / gw);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / gw));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        for (let x = x0; x < x1 && x < width; x++) {
          const i = (y * width + x) * 4;
          sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
          n += 1;
        }
      }
      gray[gy * gw + gx] = n ? sum / n : 0;
    }
  }
  let bits = "";
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw - 1; gx++) {
      bits += gray[gy * gw + gx] < gray[gy * gw + gx + 1] ? "1" : "0";
    }
  }
  let out = "";
  for (let i = 0; i < 64; i += 4) out += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return out;
}

export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    d += popcount(parseInt(a[i], 16) ^ parseInt(b[i], 16));
  }
  return d;
}

function popcount(v: number): number {
  let c = 0;
  while (v) {
    c += v & 1;
    v >>= 1;
  }
  return c;
}

/** jpeg/png 解码入口；其它 mime（webp 等）或解码失败返回 null——覆盖率如实统计。 */
export async function dhashFromBytes(bytes: Uint8Array, mime: string): Promise<string | null> {
  try {
    if (mime.includes("png")) {
      const png = PNG.sync.read(Buffer.from(bytes));
      return dhashFromRgba(png.width, png.height, new Uint8Array(png.data));
    }
    if (mime.includes("jpeg") || mime.includes("jpg")) {
      const img = jpeg.decode(Buffer.from(bytes), { useTArray: true });
      return dhashFromRgba(img.width, img.height, img.data as unknown as Uint8Array);
    }
    return null;
  } catch {
    return null;
  }
}
