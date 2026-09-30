/**
 * 复制作品图片到系统剪贴板（09-29-copy-gif）。
 *
 * 作用：copyImageToClipboard 是 navigator.clipboard.write 的纯封装，不支持/失败
 *      一律返回 false 不 throw；isGifWork / canCopyImage 是入口判定纯函数；
 *      copyWorkImage 是「取像素 → 写剪贴板 → 降级下载」执行链，CardMenu 与
 *      详情页共用。浏览态临时合成不写纸匣不动队列（R4）。
 * 用法：入口显隐 canCopyImage(work)（决策 1：有图即可，GIF 优先保动画）；
 *      点击 void copyWorkImage(work, { inVault })——纸匣态 getVaultBlob 直取
 *      第 0 页，浏览态 loadWork → collectWorkFiles({ original: true }) 现场合
 *      成；写失败降级 downloadBlob 并 toast 说明（R3）。
 * 为什么：图片剪贴板各浏览器支持参差（Chromium 支持写 image/gif，Safari/Firefox
 *      要降级），成败与降级口径集中在这一处，两个入口不要各写一份。
 */
import { toast } from "sonner";
import { collectWorkFiles } from "./save-work.ts";
import { loadWork } from "./queue-runner.ts";
import { downloadBlob, getVaultBlob, workKey } from "./storage/vault.ts";
import { extFromNameOrType } from "./ugoira-meta.ts";
import type { WorkCard, WorkDetail } from "./types.ts";

/** 判定与复制链共用的最小视图：WorkCard 必有；WorkDetail 的 ugoira/pages 可选带上。 */
export type CopyWorkLike = Pick<WorkCard, "source" | "id" | "thumb" | "illustType"> &
  Partial<Pick<WorkDetail, "ugoira" | "pages">>;

/** GIF/动图判定：pixiv ugoira（illustType===2）、详情 ugoira 元数据、藏品/附件页 ext gif。 */
export function isGifWork(work: CopyWorkLike): boolean {
  if (work.source === "pixiv" && work.illustType === 2) return true;
  if (work.ugoira) return true;
  return (work.pages ?? []).some(
    (page) =>
      extFromNameOrType(page.name) === "gif" ||
      page.original.endsWith(".gif") ||
      page.regular.endsWith(".gif"),
  );
}

/** 入口显隐（决策 1 放宽）：有图即可，静态图照出项、按 blob 自带 MIME 写剪贴板。 */
export function canCopyImage(work: CopyWorkLike): boolean {
  return Boolean(work.thumb);
}

/**
 * 写图片进系统剪贴板。mime 缺省用 blob.type（再退 image/gif）；
 * 不支持（无 clipboard/ClipboardItem）或写失败都返回 false，不 throw——降级由调用方走下载。
 */
export async function copyImageToClipboard(blob: Blob, mime?: string): Promise<boolean> {
  const type = mime || blob.type || "image/gif";
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard?.write ||
    typeof ClipboardItem === "undefined"
  ) {
    return false;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
    return true;
  } catch {
    return false;
  }
}

export type CopyWorkResult = "copied" | "downloaded" | "failed";

/**
 * 复制执行链（R2/R3）：纸匣态直取第 0 页（本地 IDB → 服务端兜底）；取不到再
 * 浏览态现场合成（original 语义，GIF 优先取 gif 条目）。合成期间 loading toast。
 * 写剪贴板失败降级 downloadBlob + toast 说明；全程不落库不进队列。
 */
export async function copyWorkImage(
  work: CopyWorkLike,
  opts?: { inVault?: boolean },
): Promise<CopyWorkResult> {
  let blob: Blob | undefined;
  let name = "";
  if (opts?.inVault) {
    // 纸匣直取失败（IDB 不可用/未落像素）退合成，不该让整链 reject
    try {
      blob = await getVaultBlob(workKey(work.source, work.id), 0);
    } catch {
      blob = undefined;
    }
    name = `${work.id}.${extFromNameOrType(undefined, blob?.type)}`;
  }
  if (!blob) {
    const loading = toast.loading(isGifWork(work) ? "正在合成 GIF…" : "正在取图…");
    try {
      const detail = await loadWork(work.source, work.id);
      const saved = await collectWorkFiles(detail, { original: true });
      const entry = saved.find((s) => extFromNameOrType(s.page.name, s.blob.type) === "gif") ?? saved[0];
      blob = entry?.blob;
      name = entry?.page.name ?? "";
    } catch (err) {
      toast.dismiss(loading);
      toast.error(err instanceof Error ? err.message : "取图失败");
      return "failed";
    }
    toast.dismiss(loading);
    name = name || `${work.id}.${extFromNameOrType(undefined, blob?.type)}`;
  }
  if (!blob) {
    toast.error("没有可复制的图片");
    return "failed";
  }
  if (await copyImageToClipboard(blob)) {
    toast.success(blob.type === "image/gif" ? "GIF 已复制，去粘贴吧" : "图片已复制，去粘贴吧");
    return "copied";
  }
  // 降级（R3）：不支持/权限拒绝 → 落一份下载文件并说明，不是静默失败
  try {
    downloadBlob(blob, name);
    toast.info("此浏览器不支持直接复制，已改为下载");
    return "downloaded";
  } catch {
    toast.error("复制与下载都没能完成，请到原站手动保存");
    return "failed";
  }
}
