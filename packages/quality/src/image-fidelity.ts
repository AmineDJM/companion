/**
 * Document image fidelity.
 *
 * A preview may be re-encoded, resized or optimised for delivery, but it must
 * not alter content. SSIM captures structural change (missing text, cropping,
 * a blank page) far better than a pixel diff, which would fail on a harmless
 * re-encode. Deliberately not a video metric: these are document pages.
 */
export interface GreyscaleImage {
  width: number;
  height: number;
  /** Row-major luminance, one byte per pixel. */
  data: Uint8Array;
}

const SSIM_WINDOW = 8;
// Stabilising constants from the original SSIM paper, for 8-bit dynamic range.
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

/**
 * Mean SSIM over a sliding window. Both images must already be the same size;
 * the caller resizes, because it owns the image library.
 */
export function structuralSimilarity(a: GreyscaleImage, b: GreyscaleImage): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error('SSIM requires images of identical dimensions');
  }
  if (a.width < SSIM_WINDOW || a.height < SSIM_WINDOW) {
    return meanSimilarityFallback(a, b);
  }

  let total = 0;
  let windows = 0;

  for (let y = 0; y + SSIM_WINDOW <= a.height; y += SSIM_WINDOW) {
    for (let x = 0; x + SSIM_WINDOW <= a.width; x += SSIM_WINDOW) {
      total += windowSsim(a, b, x, y);
      windows += 1;
    }
  }

  return windows === 0 ? meanSimilarityFallback(a, b) : total / windows;
}

function windowSsim(a: GreyscaleImage, b: GreyscaleImage, x0: number, y0: number): number {
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;
  const count = SSIM_WINDOW * SSIM_WINDOW;

  for (let y = y0; y < y0 + SSIM_WINDOW; y += 1) {
    for (let x = x0; x < x0 + SSIM_WINDOW; x += 1) {
      const index = y * a.width + x;
      const valueA = a.data[index] ?? 0;
      const valueB = b.data[index] ?? 0;
      sumA += valueA;
      sumB += valueB;
      sumAA += valueA * valueA;
      sumBB += valueB * valueB;
      sumAB += valueA * valueB;
    }
  }

  const meanA = sumA / count;
  const meanB = sumB / count;
  const varianceA = sumAA / count - meanA * meanA;
  const varianceB = sumBB / count - meanB * meanB;
  const covariance = sumAB / count - meanA * meanB;

  const numerator = (2 * meanA * meanB + C1) * (2 * covariance + C2);
  const denominator = (meanA * meanA + meanB * meanB + C1) * (varianceA + varianceB + C2);
  return denominator === 0 ? 1 : numerator / denominator;
}

function meanSimilarityFallback(a: GreyscaleImage, b: GreyscaleImage): number {
  let difference = 0;
  for (let index = 0; index < a.data.length; index += 1) {
    difference += Math.abs((a.data[index] ?? 0) - (b.data[index] ?? 0));
  }
  return 1 - difference / (a.data.length * 255);
}

/**
 * Perceptual hash (average-hash over a 8x8 reduction).
 *
 * Cheap and resolution-independent: used to spot an entirely wrong page or a
 * page served out of order, where SSIM would be needlessly expensive.
 */
export function perceptualHash(image: GreyscaleImage): bigint {
  const size = 8;
  const samples: number[] = [];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sourceX = Math.floor((x / size) * image.width);
      const sourceY = Math.floor((y / size) * image.height);
      samples.push(image.data[sourceY * image.width + sourceX] ?? 0);
    }
  }

  const mean = samples.reduce((total, value) => total + value, 0) / samples.length;
  let hash = 0n;
  for (const [index, value] of samples.entries()) {
    if (value >= mean) hash |= 1n << BigInt(index);
  }
  return hash;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let difference = a ^ b;
  let count = 0;
  while (difference > 0n) {
    count += Number(difference & 1n);
    difference >>= 1n;
  }
  return count;
}

export interface GeometryCheck {
  sourceAspect: number;
  previewAspect: number;
  deviation: number;
  orientationMatches: boolean;
}

/** Relative aspect-ratio deviation, which is what catches an accidental crop. */
export function compareGeometry(
  source: { width: number; height: number },
  preview: { width: number; height: number },
): GeometryCheck {
  const sourceAspect = source.width / source.height;
  const previewAspect = preview.width / preview.height;
  return {
    sourceAspect,
    previewAspect,
    deviation: Math.abs(previewAspect - sourceAspect) / sourceAspect,
    orientationMatches: sourceAspect >= 1 === previewAspect >= 1,
  };
}

/**
 * Share of the source page's words still legible in the preview.
 *
 * Catches the failure SSIM cannot see: a conversion that substitutes a missing
 * font and silently drops glyphs still looks structurally similar.
 */
export function textConsistency(sourceText: string, previewText: string): number {
  const source = wordSet(sourceText);
  if (source.size === 0) return 1;
  const preview = wordSet(previewText);
  let found = 0;
  for (const word of source) {
    if (preview.has(word)) found += 1;
  }
  return found / source.size;
}

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 2),
  );
}
