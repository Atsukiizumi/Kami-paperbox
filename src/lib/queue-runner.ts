/**
 * 下载 / 收入纸匣队列。
 *
 * 作用：所有落盘都从这里走：拉详情 → 收图 → archiveWork，并回报进度。
 * 用法：enqueueWork(work, "download" | "vault")。不要再调用 saveWorkNow。
 * 为什么：旁路保存会让队列页看起来是空的，进度也看不到。
 */
import { toast } from "sonner";
import { fetchSource } from "./source.ts";
import { cookiesFromSettings, useQueue, useSettings } from "./store.ts";
import { collectWorkFiles } from "./save-work.ts";
import { archiveWork } from "./persist-files.ts";
import { workKey } from "./vault.ts";
import { sleep } from "./utils.ts";
import { extFromNameOrType } from "./ugoira-meta.ts";
import { isBooru } from "./sites.ts";
import type { QueueKind, Source, WorkDetail } from "./types.ts";

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
    // PER-2：进度节流——每页一回调 × 全列表订阅，百页作品会刷爆渲染与
    // localStorage 持久化。合并到 200ms 一拍，终值在成功 patch 前落定。
    let lastAt = 0;
    let lastDone = -1;
    let lastTotal = -1;
    await saveWorkNow(item, {
      download: item.kind !== "vault",
      onProgress: (done, total) => {
        if (done === lastDone && total === lastTotal) return;
        lastDone = done;
        lastTotal = total;
        const now = Date.now();
        if (now - lastAt < 200) return;
        lastAt = now;
        useQueue.getState().patch(key, { progress: done, total });
      },
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
  enqueueWorks([work], kind);
}

export function enqueueWorks(
  works: Array<{
    source: Source;
    id: string;
    title: string;
    author: string;
    thumb: string;
  }>,
  kind: QueueKind = "download",
) {
  if (works.length === 0) return;
  const q = useQueue.getState();
  for (const work of works) {
    q.enqueue({
      key: workKey(work.source, work.id),
      source: work.source,
      id: work.id,
      title: work.title,
      author: work.author,
      thumb: work.thumb,
      kind,
    });
  }
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
