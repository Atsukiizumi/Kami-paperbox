/**
 * 零碎工具。
 *
 * 作用：className 合并、媒体代理 URL、文件名清洗、字数/体积格式。
 * 用法：mediaUrl(原图地址) 给 <img src>；不要把上游 URL 直接交给浏览器。
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function mediaUrl(url: string | undefined | null): string {
  if (!url) return "";
  if (url.startsWith("/api/") || url.startsWith("blob:") || url.startsWith("data:")) return url;
  return `/api/media?u=${encodeURIComponent(url)}`;
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|\n\r]+/g, "_").trim().slice(0, 80) || "untitled";
}

export function formatCount(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return "—";
  if (n >= 10_000) return `${(n / 10_000).toFixed(n >= 100_000 ? 0 : 1)}万`;
  if (n >= 1000) return n.toLocaleString("zh-CN");
  return String(n);
}

export function formatResolution(width?: number, height?: number): string {
  const w = Math.round(Number(width) || 0);
  const h = Math.round(Number(height) || 0);
  if (w < 1 || h < 1) return "";
  return `${w}×${h}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** FANBOX list cursors want `YYYY-MM-DD HH:mm:ss`, not `T` / `Z` / offsets. */
export function fanboxCursorTime(raw: string): string {
  return raw
    .replace("T", " ")
    .replace(/\.\d+/, "")
    .replace(/Z$/i, "")
    .replace(/[+-]\d{2}:\d{2}$/, "")
    .trim();
}

/** Decode the HTML entities we actually see in Pixiv / SauceNAO markup. Ampersand last. */
export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/\u0026quot;/g, '"')
    .replace(/\u0026#34;/g, '"')
    .replace(/\u0026#39;/g, "'")
    .replace(/\u0026apos;/g, "'")
    .replace(/\u0026lt;/g, "<")
    .replace(/\u0026gt;/g, ">")
    .replace(/\u0026nbsp;/g, " ")
    .replace(/\u0026amp;/g, "&");
}
