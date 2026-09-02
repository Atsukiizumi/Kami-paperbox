/**
 * 下载 / 收入纸匣队列。
 *
 * 作用：所有落盘都从这里走：拉详情 → 收图 → archiveWork，并回报进度。
 * 用法：enqueueWork(work, "download" | "vault")。不要再调用 saveWorkNow。
 * 为什么：旁路保存会让队列页看起来是空的，进度也看不到。
 */
import { toast } from "sonner";
import { fetchSource } from "./source";
import { cookiesFromSettings, useQueue, useSettings } from "./store";
import { collectWorkFiles } from "./save-work";
import { archiveWork } from "./persist-files";
import { workKey } from "./vault";
import { sleep } from "./utils";
import { extFromNameOrType } from "./ugoira-meta";
import { isBooru } from "./sites";
import type { QueueKind, Source, WorkDetail } from "./types";

let running = false;

export async function loadWork(source: Source, id: string): Promise<WorkDetail> {
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

export async function saveWorkNow(
  work: { source: Source; id: string; title?: string; restricted?: boolean },
  opts: { download: boolean; onProgress?: (done: number, total: number) => void },
): Promise<void> {
  if (work.restricted) throw new Error("需要有效订阅才能保存这篇投稿");
  const detail = await loadWork(work.source, work.id);
  const original = useSettings.getState().downloadOriginal;
  const saved = await collectWorkFiles(detail, { original, onProgress: opts.onProgress });
  const result = await archiveWork(detail, saved, { download: opts.download });
  const gif = saved.some((s) => extFromNameOrType(s.page.name, s.blob.type) === "gif");
  const title = detail.title || work.title || work.id;
  if (result.folder) {
    toast.success(gif ? `GIF 已收入纸匣并写入文件夹：${title}` : `已收入纸匣并写入文件夹：${title}`);
  } else if (opts.download) {
    toast.success(
      (gif ? `GIF 已下载并收入纸匣：${title}` : `已收入纸匣：${title}`) +
        (result.folderSkipped ? "，文件夹未授权" : ""),
    );
  } else {
    toast.success(
      (gif ? `GIF 已收入纸匣：${title}` : `已收入纸匣：${title}`) +
        (result.folderSkipped ? "，文件夹未授权" : ""),
    );
  }
}

async function processOne(key: string) {
  const item = useQueue.getState().items.find((x) => x.key === key);
  if (!item) return;
  useQueue.getState().patch(key, { status: "running", progress: 0, error: undefined });
  try {
    await saveWorkNow(item, {
      download: item.kind !== "vault",
      onProgress: (done, total) => useQueue.getState().patch(key, { progress: done, total }),
    });
    useQueue.getState().patch(key, { status: "done", progress: 1, total: 1 });
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
    if (useQueue.getState().items.some((x) => x.status === "queued")) void runQueue();
  }
}

export function enqueueWork(
  work: {
    source: Source;
    id: string;
    title: string;
    author: string;
    thumb: string;
  },
  kind: QueueKind = "download",
) {
  useQueue.getState().enqueue({
    key: workKey(work.source, work.id),
    source: work.source,
    id: work.id,
    title: work.title,
    author: work.author,
    thumb: work.thumb,
    kind,
  });
  void runQueue();
}

/** After a refresh, "running" rows are dead. Put them back in line and start the loop. */
export function resumeQueue() {
  for (const item of useQueue.getState().items) {
    if (item.status === "running") {
      useQueue.getState().patch(item.key, { status: "queued", error: undefined });
    }
  }
  void runQueue();
}
