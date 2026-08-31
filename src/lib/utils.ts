import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function mediaUrl(url: string | undefined | null): string {
  if (!url) return "";
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

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
