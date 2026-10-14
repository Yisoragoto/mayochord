/**
 * 节拍网格：第 0 拍在 startT（performance.now() 域，毫秒），之后每拍 beatMs。
 * 节拍偏差、节拍器显示都基于它。拍号只影响强拍与"只响 2、4 拍"。
 */
export interface BeatGrid {
  startT: number;
  beatMs: number;
  beatsPerBar: number;
}

export const bpmToBeatMs = (bpm: number) => 60_000 / bpm;

export function beatGrid(startT: number, bpm: number, beatsPerBar: number): BeatGrid {
  return { startT, beatMs: bpmToBeatMs(bpm), beatsPerBar };
}

/** 第 beat 拍的时刻（beat 可以是小数，例如 3.75 = 第 4 拍前一个 16 分音符） */
export const beatTime = (grid: BeatGrid, beat: number) => grid.startT + beat * grid.beatMs;

/** 离 t 最近的拍和偏差（正数 = 晚了） */
export function nearestBeat(grid: BeatGrid, t: number): { beat: number; offsetMs: number } {
  const beat = Math.round((t - grid.startT) / grid.beatMs);
  return { beat, offsetMs: t - beatTime(grid, beat) };
}

/** 当前在第几拍（向下取整）、这一拍过了多少（0–1）、是小节里的第几拍（0 起） */
export function beatPhase(
  grid: BeatGrid,
  t: number,
): { beat: number; frac: number; inBar: number } {
  const x = (t - grid.startT) / grid.beatMs;
  const beat = Math.floor(x);
  const inBar = ((beat % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar;
  return { beat, frac: x - beat, inBar };
}

/**
 * 算"在拍上"的容差：16 分音符时值的 45%（要能区分 16 分音符的先行切分），限制在 40–100 ms。
 * 例：72 BPM → 94 ms；100 BPM → 68 ms；140 BPM → 48 ms。
 */
export function onBeatToleranceMs(beatMs: number): number {
  return Math.min(100, Math.max(40, (beatMs / 4) * 0.45));
}

export type ClickMode = 'all' | 'backbeat' | 'off';
export type Click = 'accent' | 'normal';

/**
 * 节拍器第 beat 拍（从 0 起）响不响、是不是重音。
 * all：每拍响，强拍重音（accent 关闭时都一样）；backbeat：只响 2、4 拍（小节里的奇数拍）；off：不响。
 */
export function clickFor(
  beat: number,
  beatsPerBar: number,
  mode: ClickMode,
  accent: boolean,
): Click | null {
  const inBar = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
  if (mode === 'off') return null;
  if (mode === 'backbeat') return inBar % 2 === 1 ? 'normal' : null;
  return accent && inBar === 0 ? 'accent' : 'normal';
}
