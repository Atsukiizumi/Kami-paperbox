/**
 * 把作品页收成可存的 Blob 列表。
 *
 * 作用：拉原图或正规图；动图 unzip 后按设置合成 GIF。
 * 用法：collectWorkFiles(work, { original })，再交给 archiveWork。
 * 为什么：下载和收入纸匣走同一套，避免两处各拉一次。
 */
import { unzipUgoira } from "./ugoira-zip.ts";
import { extFromNameOrType } from "./ugoira-meta.ts";
import { mediaUrl } from "./utils.ts";
import type { WorkDetail, WorkPage } from "./types.ts";

// TD-29：单页抖动（网络断闪 / 5xx / 429）不再让整单失败——重试 2 次、递增等待。
// 服务端媒体代理对 429/503 已有自己的重试，这里兜的是浏览器侧的网络层失败。
const FETCH_BLOB_RETRIES = 2;

async function fetchBlob(url: string): Promise<Blob> {
  let lastErr: unknown = new Error("下载失败");
  for (let attempt = 0; attempt <= FETCH_BLOB_RETRIES; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 800 * attempt));
    let res: Response;
    try {
      res = await fetch(mediaUrl(url), { signal: AbortSignal.timeout(90_000) });
    } catch (err) {
      lastErr = err;
      continue; // 网络层失败：可重试
    }
    if (res.ok) return res.blob();
    lastErr = new Error(`下载失败（${res.status}）`);
    // 4xx（429 除外）是确定失败（凭据/权限），重试没有意义
    if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
  }
  throw lastErr;
}

export async function collectWorkFiles(
  work: WorkDetail,
  opts: {
    original: boolean;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<{ blob: Blob; page: WorkPage }[]> {
  if (work.restricted) throw new Error("该投稿需要有效订阅才能保存");

  if (work.ugoira) {
    const zipUrl = opts.original ? work.ugoira.originalSrc : work.ugoira.src;
    opts.onProgress?.(0, Math.max(1, work.ugoira.frames.length));
    const zipBlob = await fetchBlob(zipUrl);
    const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
    const frames = await unzipUgoira(zipBytes, work.ugoira.frames);
    try {
      const { encodeUgoiraGif } = await import("./ugoira");
      const gif = await encodeUgoiraGif(frames, {
        maxEdge: opts.original ? 1080 : 720,
        onProgress: opts.onProgress,
      });
      return [
        {
          blob: gif,
          page: {
            thumb: work.thumb,
            regular: work.pages[0]?.regular ?? "",
            original: zipUrl,
            name: `${work.id}.gif`,
          },
        },
      ];
    } catch {
      return [
        {
          blob: zipBlob,
          page: {
            thumb: work.thumb,
            regular: work.pages[0]?.regular ?? "",
            original: zipUrl,
            name: `${work.id}_ugoira.zip`,
          },
        },
      ];
    }
  }

  const pages = work.pages.filter((p) => p.original || p.regular);
  if (pages.length === 0) throw new Error("没有可保存的文件");
  const saved: { blob: Blob; page: WorkPage }[] = [];
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    const url = opts.original ? page.original || page.regular : page.regular || page.original;
    const blob = await fetchBlob(url);
    const ext = extFromNameOrType(page.name, blob.type);
    saved.push({
      blob,
      page: { ...page, name: page.name || `${work.id}_p${i}.${ext}` },
    });
    opts.onProgress?.(i + 1, pages.length);
  }
  return saved;
}
