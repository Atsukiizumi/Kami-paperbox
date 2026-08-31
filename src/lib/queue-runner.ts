import { toast } from "sonner";
import { fetchSource } from "./source";
import { cookiesFromSettings, useQueue, useSettings } from "./store";
import { collectWorkFiles } from "./save-work";
import { downloadBlob, saveVaultWork, workKey } from "./vault";
import { sanitizeFilename, sleep } from "./utils";
import { extFromNameOrType } from "./ugoira-meta";
import { isBooru } from "./sites";
import type { Source, WorkDetail } from "./types";

let running = false;

async function loadWork(source: Source, id: string): Promise<WorkDetail> {
  const creds = cookiesFromSettings();
  if (source === "pixiv") {
    const r = await fetchSource({ data: { op: "pixivIllust", id, ...creds } });
    if (r.op !== "pixivIllust") throw new Error("返回类型异常");
    return r.work;
  }
  if (source === "fanbox") {
    const r = await fetchSource({ data: { op: "fanboxPost", id, ...creds } });
    if (r.op !== "fanboxPost") throw new Error("返回类型异常");
    return r.work;
  }
  if (!isBooru(source)) throw new Error("未知站点");
  const r = await fetchSource({ data: { op: "booruPost", site: source, id, ...creds } });
  if (r.op !== "booruPost") throw new Error("返回类型异常");
  return r.work;
}

async function processOne(key: string) {
  const item = useQueue.getState().items.find((x) => x.key === key);
  if (!item) return;
  useQueue.getState().patch(key, { status: "running", progress: 0, error: undefined });
  try {
    const work = await loadWork(item.source, item.id);
    const original = useSettings.getState().downloadOriginal;
    const saved = await collectWorkFiles(work, {
      original,
      onProgress: (done, total) => useQueue.getState().patch(key, { progress: done, total }),
    });
    for (let i = 0; i < saved.length; i += 1) {
      const { blob, page } = saved[i];
      const ext = extFromNameOrType(page.name, blob.type);
      downloadBlob(blob, `${work.id}_p${i}_${sanitizeFilename(work.title)}.${ext}`);
      useQueue.getState().patch(key, { progress: i + 1, total: saved.length });
      if (i < saved.length - 1) await sleep(400);
    }
    await saveVaultWork(work, saved);
    useQueue.getState().patch(key, { status: "done", progress: saved.length, total: saved.length });
    const gif = saved.some((s) => extFromNameOrType(s.page.name, s.blob.type) === "gif");
    toast.success(gif ? `已保存 GIF：${work.title}` : `已收入纸匣：${work.title}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "保存失败";
    useQueue.getState().patch(key, { status: "error", error: message });
    toast.error(message);
  }
}

export async function runQueue() {
  if (running) return;
  running = true;
  try {
    while (true) {
      const next = useQueue.getState().items.find((x) => x.status === "queued");
      if (!next) break;
      await processOne(next.key);
      await sleep(400);
    }
  } finally {
    running = false;
  }
}

export function enqueueWork(work: {
  source: Source;
  id: string;
  title: string;
  author: string;
  thumb: string;
}) {
  useQueue.getState().enqueue({
    key: workKey(work.source, work.id),
    source: work.source,
    id: work.id,
    title: work.title,
    author: work.author,
    thumb: work.thumb,
  });
  void runQueue();
}
