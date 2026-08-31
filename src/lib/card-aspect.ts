export const FALLBACK_ASPECT = 3 / 4;
export const MIN_ASPECT = 0.45;
export const WIDE_ASPECT = 4 / 3;
export const PANORAMA_ASPECT = 2;
export const MAX_PANORAMA_ASPECT = 3.2;

export type CardLayout = "tile" | "wide" | "banner";

export function nativeAspect(width?: number, height?: number): number | null {
  const w = width ?? 0;
  const h = height ?? 0;
  if (w <= 0 || h <= 0) return null;
  return w / h;
}

export function cardLayout(width?: number, height?: number): CardLayout {
  const aspect = nativeAspect(width, height);
  if (aspect == null) return "tile";
  if (aspect >= PANORAMA_ASPECT) return "banner";
  if (aspect >= WIDE_ASPECT) return "wide";
  return "tile";
}

export function cardAspect(width?: number, height?: number): number {
  const aspect = nativeAspect(width, height);
  if (aspect == null) return FALLBACK_ASPECT;
  if (aspect >= PANORAMA_ASPECT) return Math.min(MAX_PANORAMA_ASPECT, aspect);
  return Math.max(MIN_ASPECT, aspect);
}
