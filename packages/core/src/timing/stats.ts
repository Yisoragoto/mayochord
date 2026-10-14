export function mean(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** 总体标准差 */
export function stdev(xs: readonly number[]): number | null {
  const m = mean(xs);
  if (m === null) return null;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

export interface HistogramBin {
  /** 区间 [from, to) */
  from: number;
  to: number;
  count: number;
}

/** 等宽直方图；超出范围的值归入两端的区间 */
export function histogram(
  xs: readonly number[],
  { min, max, width }: { min: number; max: number; width: number },
): HistogramBin[] {
  const n = Math.max(1, Math.ceil((max - min) / width));
  const bins: HistogramBin[] = Array.from({ length: n }, (_, i) => ({
    from: min + i * width,
    to: min + (i + 1) * width,
    count: 0,
  }));
  for (const x of xs) {
    const i = Math.min(n - 1, Math.max(0, Math.floor((x - min) / width)));
    (bins[i] as HistogramBin).count++;
  }
  return bins;
}
