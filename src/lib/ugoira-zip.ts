import { unzipSync } from "fflate";
import type { UgoiraFrame } from "./ugoira-meta";

export async function unzipUgoira(
  zipBytes: Uint8Array,
  frames: UgoiraFrame[],
): Promise<{ file: string; delay: number; bytes: Uint8Array }[]> {
  const files = unzipSync(zipBytes);
  const out: { file: string; delay: number; bytes: Uint8Array }[] = [];
  for (const frame of frames) {
    const data = files[frame.file];
    if (!data) continue;
    out.push({ file: frame.file, delay: frame.delay, bytes: data });
  }
  if (out.length === 0) throw new Error("动图压缩包里没有帧");
  return out;
}
