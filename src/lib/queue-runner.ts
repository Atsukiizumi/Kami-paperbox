/**
 * 下载队列执行器。
 *
 * 作用：串行处理排队作品：拉详情 → 收图 → archiveWork。
 * 用法：enqueueWork 入队后会自己 kick；页面刷新后若还有 queued 再 kick 一次。
 * 为什么：并行会打爆源站和浏览器下载。状态在 localStorage，文件在纸匣。
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
    const result = await archiveWork(work, saved, { download: true });
    useQueue.getState().patch(key, { status: "done", progress: saved.length, total: saved.length });
    const gif = saved.some((s) => extFromNameOrType(s.page.name, s.blob.type) === "gif");
    const title = work.title;
    if (result.folder) toast.success(gif ? `已写入文件夹：${title}` : `已收入纸匣并写入文件夹：${title}`);
    else if (result.folderSkipped) toast.success(gif ? `GIF 已保存，文件夹未授权` : `已收入纸匣：${title}`);
    else toast.success(gif ? `已保存 GIF：${title}` : `已收入纸匣：${title}`);
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
