import assert from "node:assert/strict";
import { test } from "node:test";
import { dhashFromRgba, hammingHex, dhashFromBytes } from "./dhash.ts";
import { PNG } from "pngjs";

// 生成渐变图（同内容、不同尺寸应得到相近哈希）
function makeRgba(w: number, h: number, paint: (x: number, y: number) => [number, number, number]): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      out.set([r, g, b, 255], (y * w + x) * 4);
    }
  }
  return out;
}

test("hash 形状是 16 位 hex", () => {
  const h = dhashFromRgba(64, 64, makeRgba(64, 64, () => [128, 128, 128]));
  assert.match(h, /^[0-9a-f]{16}$/);
});

test("同内容不同尺寸 → 汉明距离小", () => {
  // 单调平滑渐变（不取模，避免锯齿化后块平均不可比）
  const paintOf = (w: number, h: number) => (x: number, y: number) =>
    [Math.round((x / w) * 255), Math.round((y / h) * 255), 128] as [number, number, number];
  const a = dhashFromRgba(300, 300, makeRgba(300, 300, paintOf(300, 300)));
  const b = dhashFromRgba(160, 200, makeRgba(160, 200, paintOf(160, 200)));
  assert.ok(hammingHex(a, b) <= 6, `distance=${hammingHex(a, b)}`);
});

test("明显不同内容 → 距离大", () => {
  // 左：纯灰。右：竖条交替——水平差分位翻转密集，距离必然大。
  const flat = dhashFromRgba(64, 64, makeRgba(64, 64, () => [128, 128, 128]));
  const stripes = dhashFromRgba(64, 64, makeRgba(64, 64, (x) => (x % 16 < 8 ? [255, 255, 255] : [0, 0, 0])));
  assert.ok(hammingHex(flat, stripes) >= 20, `distance=${hammingHex(flat, stripes)}`);
});

test("png 解码路径 + webp 返回 null", async () => {
  const png = new PNG({ width: 40, height: 40 });
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 40; x++) {
      const i = (40 * y + x) << 2;
      png.data[i] = (x * 6) % 256;
      png.data[i + 1] = (y * 6) % 256;
      png.data[i + 3] = 255;
    }
  }
  const buf = PNG.sync.write(png);
  const h = await dhashFromBytes(new Uint8Array(buf), "image/png");
  assert.match(h ?? "", /^[0-9a-f]{16}$/);
  assert.equal(await dhashFromBytes(new Uint8Array([1]), "image/webp"), null);
  assert.equal(await dhashFromBytes(new Uint8Array([1, 2]), "image/jpeg"), null); // 坏字节 → null 不抛
});
