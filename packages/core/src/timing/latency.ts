import { median } from '../grading/grade';
import { stdev } from './stats';

/**
 * 延迟校准（规格 9）：用户跟着节拍器敲键，每次按下相对最近拍点的偏差的中位数就是偏移量
 * （包括音频输出延迟、MIDI 输入延迟和个人习惯）。之后所有节拍偏差都扣除它。
 */
export interface LatencyParams {
  /** 前几下不算（刚开始还没跟上） */
  warmup: number;
  /** 至少需要多少下有效敲击 */
  minTaps: number;
  /** 离中位数超过 max(3 × MAD, floorMs) 的算离群值 */
  outlierFloorMs: number;
  /** 标准差不超过这个值才算稳定 */
  maxStdevMs: number;
}

export const DEFAULT_LATENCY: LatencyParams = {
  warmup: 4,
  minTaps: 8,
  outlierFloorMs: 40,
  maxStdevMs: 35,
};

export interface LatencyEstimate {
  offsetMs: number;
  stdevMs: number;
  used: number;
  /** 有效敲击够多、足够稳定，可以采用 */
  ok: boolean;
}

/** taps：按下时刻；beats：拍点时刻（都在 performance.now() 域）。离最近拍点超过半拍的敲击忽略。 */
export function estimateLatency(
  taps: readonly number[],
  beats: readonly number[],
  params: LatencyParams = DEFAULT_LATENCY,
): LatencyEstimate | null {
  if (beats.length < 2) return null;
  const sorted = [...beats].sort((a, b) => a - b);
  const beatMs = ((sorted.at(-1) as number) - (sorted[0] as number)) / (sorted.length - 1);
  const offsets: number[] = [];
  for (const t of taps.slice(params.warmup)) {
    let best: number | null = null;
    for (const b of sorted) if (best === null || Math.abs(t - b) < Math.abs(best)) best = t - b;
    if (best !== null && Math.abs(best) <= beatMs / 2) offsets.push(best);
  }
  const m = median(offsets);
  if (m === null) return null;
  const mad = median(offsets.map((o) => Math.abs(o - m))) as number;
  const limit = Math.max(3 * mad, params.outlierFloorMs);
  const kept = offsets.filter((o) => Math.abs(o - m) <= limit);
  const offsetMs = median(kept) as number;
  const sd = stdev(kept) as number;
  return {
    offsetMs: Math.round(offsetMs),
    stdevMs: Math.round(sd),
    used: kept.length,
    ok: kept.length >= params.minTaps && sd <= params.maxStdevMs,
  };
}
