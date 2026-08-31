export const FALLBACK_ASPECT = 3 / 4;
export const MIN_ASPECT = 0.45;
export const MAX_ASPECT = 2.2;

export function cardAspect(width?: number, height?: number): number {
  const w = width ?? 0;
  const h = height ?? 0;
  if (w <= 0 || h <= 0) return FALLBACK_ASPECT;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, w / h));
}
