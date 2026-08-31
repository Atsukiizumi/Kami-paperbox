/**
 * 把作品页收成可存的 Blob 列表。
 *
 * 作用：拉原图或正规图；动图 unzip 后按设置合成 GIF。
 * 用法：collectWorkFiles(work, { original })，再交给 archiveWork。
 * 为什么：下载和收入纸匣走同一套，避免两处各拉一次。
 */
import { unzipUgoira } from "./ugoira-zip";
import { extFromNameOrType } from "./ugoira-meta";
import { mediaUrl } from "./utils";
import type { WorkDetail, WorkPage } from "./types";

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(mediaUrl(url), { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`下载失败（${res.status}）`);
  return res.blob();
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
