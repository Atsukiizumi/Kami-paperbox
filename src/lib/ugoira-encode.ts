/**
 * ugoira GIF 合成的 Worker 包装（X5，09-22-batch3-download-deploy）。
 *
 * 作用：帧解码与 GIF 编码移出主线程——大批动图收藏不再卡 UI。
 * 用法：encodeUgoiraGifViaWorker(frames, { maxEdge, onProgress })——优先 Web
 *      Worker（结构化克隆传帧、进度消息回传），Worker 不可用/失败/60s 超时
 *      回退主线程 encodeUgoiraGif，行为不降级。
 * 为什么保留主线程路径：jsdom/老环境没有 Worker；合成慢好过合成不了。
 */
import { encodeUgoiraGif } from "./ugoira.ts";

type Frames = { delay: number; bytes: Uint8Array }[];

export async function encodeUgoiraGifViaWorker(
  frames: Frames,
  opts: { maxEdge: number; onProgress?: (done: number, total: number) => void },
): Promise<Blob> {
  if (typeof Worker === "function") {
    try {
      return await runInWorker(frames, opts);
    } catch {
      /* Worker 路径失败：回退主线程 */
    }
  }
  return encodeUgoiraGif(frames, opts);
}

function runInWorker(frames: Frames, opts: { maxEdge: number; onProgress?: (done: number, total: number) => void }): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./ugoira-worker.ts", import.meta.url), { type: "module" });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("GIF 合成超时"));
    }, 60_000);
    worker.onmessage = (ev: MessageEvent<{ ok: true; gif: Blob } | { ok: false; error: string } | { type: "progress"; done: number; total: number }>) => {
      const data = ev.data;
      if ("type" in data) {
        opts.onProgress?.(data.done, data.total);
        return;
      }
      clearTimeout(timer);
      worker.terminate();
      if (data.ok) resolve(data.gif);
      else reject(new Error(data.error));
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error("GIF Worker 失败"));
    };
    worker.postMessage({ frames, maxEdge: opts.maxEdge });
  });
}
