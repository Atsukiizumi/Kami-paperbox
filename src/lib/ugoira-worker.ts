/**
 * ugoira GIF 合成 Worker 入口（X5）。主线程经 ugoira-encode.ts 投递帧与参数，
 * 这里在后台线程跑 encodeUgoiraGif 并回传 Blob；进度以消息回传。
 */
import { encodeUgoiraGif } from "./ugoira.ts";

self.onmessage = async (ev: MessageEvent<{ frames: { delay: number; bytes: Uint8Array }[]; maxEdge: number }>) => {
  const { frames, maxEdge } = ev.data;
  try {
    const gif = await encodeUgoiraGif(frames, {
      maxEdge,
      onProgress: (done, total) => {
        self.postMessage({ type: "progress", done, total });
      },
    });
    self.postMessage({ ok: true, gif });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
