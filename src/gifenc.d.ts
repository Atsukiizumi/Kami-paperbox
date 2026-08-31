declare module "gifenc" {
  export function GIFEncoder(opt?: { initialCapacity?: number; auto?: boolean }): {
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      opts?: {
        palette?: number[][];
        delay?: number;
        repeat?: number;
        transparent?: boolean;
        first?: boolean;
      },
    ) => void;
    finish: () => void;
    bytes: () => Uint8Array;
  };
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: object,
  ): number[][];
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: string,
  ): Uint8Array;
}

declare module "gifenc/dist/gifenc.esm.js" {
  export { GIFEncoder, applyPalette, quantize } from "gifenc";
}
