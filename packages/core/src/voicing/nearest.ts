import { type ChordQuality, chordQualityDef } from '../theory/chord-symbol';
import { nameToPitchClass, pitchClass } from '../theory/notes';
import { voiceLeading } from './voice-leading';

export interface RightHandSearchOptions {
  /** 右手音数，默认 3 */
  size?: number;
  /** 搜索范围（MIDI，含两端），默认 G3–G5 */
  low?: number;
  high?: number;
  /** 最大跨度（半音），默认 12 */
  maxSpan?: number;
  /** 必须包含的度数。默认：七和弦/九和弦用三音、七音（和九音），三和弦全部 */
  requiredDegrees?: readonly number[];
}

export interface RightHandCandidate {
  notes: number[];
  total: number;
  maxMove: number;
  span: number;
}

function defaultRequired(quality: ChordQuality): number[] {
  const degrees = chordQualityDef(quality).tones.map((t) => t.degree);
  if (degrees.includes(7)) return degrees.filter((d) => d === 3 || d === 7 || d === 9);
  return degrees;
}

function* combinations(items: readonly number[], k: number, start = 0): Generator<number[]> {
  if (k === 0) {
    yield [];
    return;
  }
  for (let i = start; i <= items.length - k; i++) {
    for (const rest of combinations(items, k - 1, i + 1)) yield [items[i] as number, ...rest];
  }
}

/**
 * 就近转位：在范围内枚举右手键位，按与前一个右手键位的声部进行移动量排序。
 * 规则（规格第 11 节）：右手就近转位，每次尽量只移动半音或全音；左手弹根音，右手可以省略根音和五音。
 * 排序：移动总量 → 最大单步移动 → 跨度。
 */
export function rankRightHandVoicings(
  prev: readonly number[],
  rootName: string,
  quality: ChordQuality,
  options: RightHandSearchOptions = {},
): RightHandCandidate[] {
  const { size = 3, low = 55, high = 79, maxSpan = 12 } = options;
  const required = options.requiredDegrees ?? defaultRequired(quality);
  const rootPc = nameToPitchClass(rootName);
  if (rootPc === null) throw new Error(`Invalid root name: ${rootName}`);
  const degreeOfPc = new Map<number, number>();
  for (const t of chordQualityDef(quality).tones) {
    degreeOfPc.set(pitchClass(rootPc + t.semitones), t.degree);
  }

  const pool: number[] = [];
  for (let n = low; n <= high; n++) if (degreeOfPc.has(pitchClass(n))) pool.push(n);

  const out: RightHandCandidate[] = [];
  for (const notes of combinations(pool, size)) {
    const span = (notes[notes.length - 1] as number) - (notes[0] as number);
    if (span > maxSpan) continue;
    const degrees = new Set(notes.map((n) => degreeOfPc.get(pitchClass(n))));
    if (degrees.size !== notes.length) continue; // 右手不重复同一个音级
    if (!required.every((d) => degrees.has(d))) continue;
    const vl = voiceLeading(prev, notes);
    out.push({ notes, total: vl.total, maxMove: vl.maxMove, span });
  }
  return out.sort((a, b) => a.total - b.total || a.maxMove - b.maxMove || a.span - b.span);
}

/** 左手根音：在范围内（默认 E2–B3）选离前一个左手音最近的根音。 */
export function nearestBass(prevBass: number, rootName: string, low = 40, high = 59): number {
  const rootPc = nameToPitchClass(rootName);
  if (rootPc === null) throw new Error(`Invalid root name: ${rootName}`);
  let best: number | null = null;
  for (let n = low; n <= high; n++) {
    if (pitchClass(n) !== rootPc) continue;
    if (best === null || Math.abs(n - prevBass) < Math.abs(best - prevBass)) best = n;
  }
  if (best === null) throw new Error(`No ${rootName} between ${low} and ${high}`);
  return best;
}
