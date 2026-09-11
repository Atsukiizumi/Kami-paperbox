/**
 * 下载 / 收入纸匣队列。
 *
 * 作用：所有落盘都从这里走：拉详情 → 收图 → archiveWork，并回报进度。
 * 用法：enqueueWork(work, "download" | "vault")。不要再调用 saveWorkNow。
 * 为什么：旁路保存会让队列页看起来是空的，进度也看不到。
 *
 * M6：
 * - 并发：设置里 queueConcurrency（1-4）个工作位，同时处理多条。
 * - 重试：失败指数退避自动重排（最多 MAX_QUEUE_ATTEMPTS 次）；用户态错误
 *   （要登录/订阅/内容不可用）不重试，直接判死。
 * - 跨标签页：Web Locks 全局唯一执行者（一个标签页跑队列，其余镜像展示）；
 *   BroadcastChannel 把队列状态实时镜像到其他标签页。执行者关闭后锁自动
 *   释放，别的标签页 2s 内接管。
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
import { clampQueueConcurrency, MAX_QUEUE_ATTEMPTS, queueBackoffMs, queueShouldRetry } from "./queue-retry.ts";
import type { QueueItem, QueueKind, Source, WorkDetail } from "./types.ts";

const RUNNER_LOCK = "kami-queue-runner";

let running = false;
/** 本标签页正在处理的 key（同一 tick 内防止同一项被取两次）。 */
const runningKeys = new Set<string>();

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
      (gif ? "GIF 已下载并收入纸匣：" : "已收入纸匣：") + title + (result.folderSkipped ? "，文件夹未授权" : ""),
    );
  } else {
    toast.success(
      (gif ? "GIF 已收入纸匣：" : "已收入纸匣：") + title + (result.folderSkipped ? "，文件夹未授权" : ""),
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
    useQueue.getState().patch(key, { status: "done", progress: 1, total: 1, attempts: undefined, nextRetryAt: undefined });
  } catch (err) {
    const message = err instanceof Error ? err.message : "保存失败";
    const attempts = (item.attempts ?? 0) + 1;
    if (attempts < MAX_QUEUE_ATTEMPTS && queueShouldRetry(message)) {
      // 指数退避：立即回到排队态但挂 nextRetryAt，worker 到点才取
      const backoff = queueBackoffMs(attempts);
      useQueue.getState().patch(key, { status: "queued", attempts, error: message, nextRetryAt: Date.now() + backoff });
      setTimeout(() => void runQueue(), backoff + 100);
      toast.info(`「${item.title}」失败，${Math.round(backoff / 1000)}s 后自动重试（${attempts}/${MAX_QUEUE_ATTEMPTS - 1}）`);
      return;
    }
    useQueue.getState().patch(key, { status: "error", attempts, error: message, nextRetryAt: undefined });
    toast.error(message);
  }
}

/** 就绪 = 排队中且退避等待已过。 */
function nextReadyKey(): string | undefined {
  const now = Date.now();
  return useQueue
    .getState()
    .items.find((x) => x.status === "queued" && (x.nextRetryAt ?? 0) <= now && !runningKeys.has(x.key))?.key;
}

function hasReadyWork(): boolean {
  return nextReadyKey() !== undefined;
}

/**
 * 取锁后打一波：启动至多 queueConcurrency 个处理位，等这一批全部落定。
 * 返回是否实际处理了条目；false = 没锁或没就绪项。
 */
async function pumpWave(): Promise<boolean> {
  let started = false;
  let active = 0;
  return new Promise((resolve) => {
    const tryStart = () => {
      const cap = clampQueueConcurrency(useSettings.getState().queueConcurrency);
      while (active < cap) {
        const key = nextReadyKey();
        if (!key) break;
        runningKeys.add(key);
        started = true;
        active++;
        void processOne(key)
          .catch(() => undefined)
          .finally(() => {
            runningKeys.delete(key);
            active--;
            if (active === 0) resolve(started);
            else tryStart();
          });
      }
      if (active === 0 && !started) resolve(false);
    };
    tryStart();
  });
}

/** Web Locks 可用则只在拿到全局锁时跑（跨标签页唯一执行者）；不可用照旧单标签页跑。 */
async function runWave(): Promise<boolean> {
  const locks = typeof navigator !== "undefined" && navigator.locks;
  if (!locks) return pumpWave();
  return locks.request(
    RUNNER_LOCK,
    { ifAvailable: true },
    (lock) => (lock ? pumpWave() : Promise.resolve(false)), // 没锁 = 别的标签页在跑
  );
}

export async function runQueue() {
  if (running) return;
  running = true;
  try {
    while (hasReadyWork() || useQueue.getState().items.some((x) => x.status === "running")) {
      const started = await runWave();
      if (!started) {
        await sleep(2000); // 锁在别的标签页手上；它关掉后这里接管
        continue;
      }
      await sleep(400);
    }
  } finally {
    running = false;
    // 退避中的项到点会自己叫醒；兜底再拉一次防漏
    if (useQueue.getState().items.some((x) => x.status === "queued")) {
      setTimeout(() => void runQueue(), 1500);
    }
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
      useQueue.getState().patch(item.key, { status: "queued", error: undefined, nextRetryAt: undefined });
    }
  }
  void runQueue();
}

/**
 * 跨标签页镜像（M6）：执行者标签页的每次队列变更广播出去，其他标签页静默
 * 应用——队列页在任何标签页都能看到实时进度。app-shell 挂载时调一次。
 */
export function mirrorQueueAcrossTabs() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel("kami-queue");
  let applying = false;
  const off = useQueue.subscribe(() => {
    if (applying) return;
    try {
      channel.postMessage({ type: "queue", items: useQueue.getState().items });
    } catch {
      /* 镜像失败不影响本标签页 */
    }
  });
  channel.onmessage = (ev: MessageEvent) => {
    const data = ev.data as { type?: string; items?: QueueItem[] } | null;
    if (!data || data.type !== "queue" || !Array.isArray(data.items)) return;
    applying = true;
    try {
      useQueue.setState({ items: data.items });
    } finally {
      applying = false;
    }
  };
  return () => {
    off();
    channel.close();
  };
}
