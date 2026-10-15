/**
 * 导入乐谱的统一模型（规格第 10 节第 8 条）。MusicXML 与 MIDI 都解析成它：
 * - notes：演奏用的音（连音线已合并），判定和瀑布流用；
 * - elements：记谱用的音符/休止符（时值类型、附点、三连音、连音线），五线谱用；
 * - measures：小节（拍号、调号、谱号）。
 * 时间单位一律是 tick，四分音符 = TPQ。
 */

import type { Hand } from '../voicing';
import type { MeasureFlow } from './repeats';

export type { Hand };

export const TPQ = 960;

export type Clef = 'treble' | 'bass' | 'alto';
export type DurationType = 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd' | '64th';

/** 演奏用的一个音 */
export interface ScoreNote {
  /** notes 数组里的下标 */
  id: number;
  /** MIDI 号 */
  pitch: number;
  start: number;
  /** 时值（连音线已合并） */
  dur: number;
  hand: Hand;
  /** 开始所在小节的下标 */
  measure: number;
}

/** 记谱里的一个音（和弦里的每个音一个） */
export interface NotationPitch {
  pitch: number;
  /** 拼写过的音名，例如 'Bb4' */
  spelled: string;
  /** 对应的演奏音（连音线后半段指向前半段的音） */
  noteId: number;
  tieStart: boolean;
  tieStop: boolean;
  /** 需要画出的临时记号：'#'、'b'、'n'、'##'、'bb'；不需要为 null（assignAccidentals 计算） */
  accidental: string | null;
}

/** 记谱里的一个音符/和弦/休止符 */
export interface NotationElement {
  measure: number;
  /** 谱表，1 起 */
  staff: number;
  voice: string;
  start: number;
  dur: number;
  rest: boolean;
  type: DurationType;
  dots: number;
  /** 连音（例如三连音 { actual: 3, normal: 2 }） */
  tuplet: { actual: number; normal: number } | null;
  /** 低到高；休止符为空 */
  pitches: NotationPitch[];
}

export interface ScoreMeasure {
  index: number;
  /** 谱上的小节号（MusicXML 的 number 属性），弱起小节可能是 '0' */
  number: string;
  start: number;
  length: number;
  beats: number;
  beatType: number;
  /** 调号：正数 = 升号个数，负数 = 降号个数 */
  fifths: number;
  /** 每个谱表在这个小节的谱号 */
  clefs: Clef[];
  /** 反复记号、跳房子、D.C./D.S. 等（只有 MusicXML 有） */
  flow?: MeasureFlow;
}

export interface Score {
  title: string;
  composer: string | null;
  format: 'musicxml' | 'midi';
  /** 谱表数（1 或 2） */
  staves: number;
  /** 每个谱表是哪只手 */
  staffHands: Hand[];
  measures: ScoreMeasure[];
  notes: ScoreNote[];
  elements: NotationElement[];
  /** 四分音符的速度（谱上第一个速度标记；没有时 120） */
  tempo: number;
  /** 谱上有速度标记 */
  tempoMarked: boolean;
  /** 演奏顺序（小节下标，反复记号已展开）；没有反复时就是 0…n-1 */
  playback: number[];
  /** 导入时的提示（例如反复记号没有展开、只导入了两个声部） */
  warnings: ScoreWarning[];
}

export type ScoreWarning =
  | { kind: 'tempo-changes' }
  | { kind: 'grace-notes' }
  | { kind: 'parts-ignored'; parts: string[] }
  | { kind: 'quantized' };

const TYPE_TICKS: [DurationType, number][] = [
  ['whole', TPQ * 4],
  ['half', TPQ * 2],
  ['quarter', TPQ],
  ['eighth', TPQ / 2],
  ['16th', TPQ / 4],
  ['32nd', TPQ / 8],
  ['64th', TPQ / 16],
];

export const DURATION_TYPES: readonly DurationType[] = TYPE_TICKS.map(([t]) => t);

/** 时值类型的 tick 数（不含附点、连音） */
export function typeTicks(type: DurationType): number {
  return (TYPE_TICKS.find(([t]) => t === type) as [DurationType, number])[1];
}

/** 时值类型 + 附点（+ 连音）的实际 tick 数 */
export function notatedTicks(
  type: DurationType,
  dots: number,
  tuplet: { actual: number; normal: number } | null = null,
): number {
  const base = typeTicks(type);
  let total = base;
  let add = base;
  for (let i = 0; i < dots; i++) {
    add /= 2;
    total += add;
  }
  return tuplet ? (total * tuplet.normal) / tuplet.actual : total;
}

/** tick 数能直接写成一个音符（最多两个附点）时返回类型与附点；否则 null */
export function ticksToType(ticks: number): { type: DurationType; dots: number } | null {
  for (const [type] of TYPE_TICKS) {
    for (let dots = 0; dots <= 2; dots++) {
      if (notatedTicks(type, dots) === ticks) return { type, dots };
    }
  }
  return null;
}

/**
 * 把一段时值拆成能写出来的音符（每段最多一个附点），从长到短。
 * 例：5 个八分音符 → 二分 + 八分。最短 64 分音符，更短的余数丢掉。
 */
export function splitTicks(ticks: number): { type: DurationType; dots: number; ticks: number }[] {
  const out: { type: DurationType; dots: number; ticks: number }[] = [];
  let rest = ticks;
  while (rest >= TPQ / 16) {
    let piece: { type: DurationType; dots: number; ticks: number } | null = null;
    for (const [type, base] of TYPE_TICKS) {
      if (base * 1.5 <= rest) {
        piece = { type, dots: 1, ticks: base * 1.5 };
        break;
      }
      if (base <= rest) {
        piece = { type, dots: 0, ticks: base };
        break;
      }
    }
    if (!piece) break;
    out.push(piece);
    rest -= piece.ticks;
  }
  return out;
}

/** 小节下标：tick 落在哪个小节（超出最后一个小节时为最后一个） */
export function measureAt(measures: readonly ScoreMeasure[], tick: number): number {
  let lo = 0;
  let hi = measures.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((measures[mid] as ScoreMeasure).start <= tick) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/** 有反复记号（演奏顺序与谱面顺序不同） */
export function hasRepeats(score: Score): boolean {
  return score.playback.length !== score.measures.length || score.playback.some((m, i) => m !== i);
}

/** 乐谱结束的 tick */
export function scoreEnd(score: Score): number {
  const last = score.measures[score.measures.length - 1];
  return last ? last.start + last.length : 0;
}
