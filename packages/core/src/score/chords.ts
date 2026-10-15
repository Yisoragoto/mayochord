import {
  type ChordQuality,
  type ChordSymbol,
  chordQualityDef,
  formatChordSymbol,
  majorScale,
  nameToPitchClass,
  pitchClass,
  pitchClassName,
  symbolFromNames,
} from '../theory';
import { type Score, type ScoreMeasure, TPQ } from './model';

/**
 * 自动标和弦（规格第 10 节第 8 条，M8）：按每小节（必要时半小节）里响着的音推测和弦名。
 * 只供参考：同样的音可以有不同的解释，旋律里的经过音也会干扰。
 *
 * 做法：
 * 1. 音级权重：每个音在这段时间里响的时长（四分音符 = 1）；在段落开头就响着的 × 1.3，左手 × 1.3；
 *    低音（段落开头响着、或第一拍里开始的最低音）另外加权。
 * 2. 对每个根音 × 和弦性质打分：和弦音的权重和 − 0.6 × 非和弦音的权重和；缺三音扣分；
 *    七音、九音、六音、sus 的特征音要有足够的权重（≥ 总权重的 12%）才选这种和弦；
 *    低音是根音加分，转位稍微扣分；sus 和弦只在根音是低音时考虑；复杂的和弦稍微扣分，同分时选简单的。
 * 3. 每小节先整小节判断；两个半小节的根音不同、且分开判断明显更好时分成两个。
 * 4. 得分太低（例如只有一两个旋律音）时不标。
 */

export interface ChordLabel {
  measure: number;
  /** 谱面上的开始、结束（tick） */
  start: number;
  end: number;
  symbol: ChordSymbol;
  /** 显示用文本，例如 'Am7'、'C/E' */
  text: string;
  /** 0–1：和弦音占这段时间响着的音的比例（扣掉非和弦音之后） */
  confidence: number;
}

const QUALITIES: readonly ChordQuality[] = [
  'maj',
  'm',
  '7',
  'M7',
  'm7',
  'm7b5',
  'dim',
  'dim7',
  'aug',
  'sus4',
  'sus2',
  'add9',
  '7(9)',
  'M7(9)',
  'm7(9)',
  '6',
  'm6',
];

/** 和弦里需要证据的特征音（相对根音的半音数）：没有足够权重就不选这种和弦 */
function characteristic(quality: ChordQuality): number[] {
  const def = chordQualityDef(quality);
  const out: number[] = [];
  for (const t of def.tones) {
    if (t.degree === 7 || t.degree === 9 || (t.degree === 6 && t.semitones % 12 === 9)) {
      out.push(t.semitones % 12);
    }
  }
  if (quality === 'sus4') out.push(5);
  if (quality === 'sus2') out.push(2);
  if (quality === 'aug') out.push(8);
  if (quality === 'dim' || quality === 'm7b5' || quality === 'dim7') out.push(6);
  return out;
}

const NON_CHORD = 0.6;
const EVIDENCE = 0.12;
const MIN_CONFIDENCE = 0.45;
/** 根音至少占总权重的比例 */
const ROOT_MIN = 0.12;

interface Profile {
  w: number[];
  total: number;
  /** 低音的音级；没有为 null */
  bass: number | null;
}

function profile(score: Score, start: number, end: number): Profile {
  const w = Array.from({ length: 12 }, () => 0);
  let bass: number | null = null;
  for (const n of score.notes) {
    const a = Math.max(start, n.start);
    const b = Math.min(end, n.start + n.dur);
    if (b <= a) continue;
    let weight = (b - a) / TPQ;
    if (n.start <= start) weight *= 1.3;
    if (n.hand === 'left') weight *= 1.3;
    const pc = pitchClass(n.pitch);
    w[pc] = (w[pc] as number) + weight;
    // 低音：段落开头响着，或第一拍里开始的最低音
    if (n.start < start + TPQ && (bass === null || n.pitch < bass)) bass = n.pitch;
  }
  const total = w.reduce((s, x) => s + x, 0);
  return { w, total, bass: bass === null ? null : pitchClass(bass) };
}

interface Candidate {
  root: number;
  quality: ChordQuality;
  score: number;
  /** 和弦音权重 − 0.6 × 非和弦音权重，占总权重的比例 */
  fit: number;
  /** 低音是和弦音但不是根音 */
  slashBass: number | null;
}

function best(p: Profile): Candidate | null {
  if (p.total <= 0) return null;
  let top: Candidate | null = null;
  for (let root = 0; root < 12; root++) {
    if ((p.w[root] as number) < p.total * ROOT_MIN) continue;
    for (const quality of QUALITIES) {
      const def = chordQualityDef(quality);
      // sus 和弦只在根音就是低音时考虑（否则多半是别的和弦加了经过音）
      if ((quality === 'sus4' || quality === 'sus2') && p.bass !== null && p.bass !== root) {
        continue;
      }
      const tones = new Set(def.intervals.map((i) => (root + i) % 12));
      if (
        characteristic(quality).some((i) => (p.w[(root + i) % 12] as number) < p.total * EVIDENCE)
      ) {
        continue;
      }
      let inChord = 0;
      let outside = 0;
      let present = 0;
      for (let pc = 0; pc < 12; pc++) {
        if (tones.has(pc)) {
          inChord += p.w[pc] as number;
          if ((p.w[pc] as number) > 0) present++;
        } else outside += p.w[pc] as number;
      }
      // 只有一个音（例如单音旋律）不标和弦
      if (present < 2) continue;
      const fit = (inChord - NON_CHORD * outside) / p.total;
      let score = inChord - NON_CHORD * outside;
      const third = def.tones.find((t) => t.degree === 3);
      if (third && (p.w[(root + third.semitones) % 12] as number) === 0) score -= p.total * 0.08;
      if (p.bass !== null) {
        if (p.bass === root) score += p.total * 0.15;
        // 转位比原位少见；低音不是和弦音更少见
        else score -= p.total * (tones.has(p.bass) ? 0.05 : 0.08);
      }
      // 越复杂越要多一点证据（同分时选简单的）
      score -= (def.tones.length - 3) * p.total * 0.04 + (10 - def.commonness) * p.total * 0.005;
      if (!top || score > top.score) {
        const slashBass = p.bass !== null && p.bass !== root && tones.has(p.bass) ? p.bass : null;
        top = { root, quality, score, fit, slashBass };
      }
    }
  }
  return top;
}

/** 音级在调里的拼写：调内音按音阶，调外音按调号方向的升降 */
export function spellInKey(pc: number, fifths: number): string {
  const tonics = [
    'Cb',
    'Gb',
    'Db',
    'Ab',
    'Eb',
    'Bb',
    'F',
    'C',
    'G',
    'D',
    'A',
    'E',
    'B',
    'F#',
    'C#',
  ];
  const tonic = tonics[Math.max(-7, Math.min(7, fifths)) + 7] as string;
  const inScale = majorScale(tonic).find((name) => nameToPitchClass(name) === pc);
  if (inScale) return inScale;
  return pitchClassName(pc, fifths > 0 ? 'sharp' : fifths < 0 ? 'flat' : undefined);
}

function label(m: ScoreMeasure, start: number, end: number, c: Candidate): ChordLabel {
  const rootName = spellInKey(c.root, m.fifths);
  const symbol = symbolFromNames(
    rootName,
    c.quality,
    c.slashBass === null ? undefined : spellInKey(c.slashBass, m.fifths),
  );
  return {
    measure: m.index,
    start,
    end,
    symbol,
    text: formatChordSymbol(symbol),
    confidence: Math.max(0, Math.min(1, c.fit)),
  };
}

/** 一个小节能不能分成两半：拍数是偶数（6/8 也可以） */
function halfOf(m: ScoreMeasure): number | null {
  const beats = Math.round((m.length * m.beatType) / (4 * TPQ));
  return beats >= 2 && beats % 2 === 0 ? m.length / 2 : null;
}

export function labelChords(score: Score): ChordLabel[] {
  const out: ChordLabel[] = [];
  for (const m of score.measures) {
    const end = m.start + m.length;
    const whole = profile(score, m.start, end);
    const w = best(whole);
    const half = halfOf(m);
    if (half !== null) {
      const p1 = profile(score, m.start, m.start + half);
      const p2 = profile(score, m.start + half, end);
      const a = best(p1);
      const b = best(p2);
      const wholeScore = w && w.fit >= MIN_CONFIDENCE ? w.score : 0;
      // 低音在小节中间换了：和弦多半也换了，分开的门槛低一些
      const bassMoves = p1.bass !== null && p2.bass !== null && p1.bass !== p2.bass;
      if (
        a &&
        b &&
        a.root !== b.root &&
        a.fit >= MIN_CONFIDENCE &&
        b.fit >= MIN_CONFIDENCE &&
        a.score + b.score > wholeScore + whole.total * (bassMoves ? -0.1 : 0.1)
      ) {
        out.push(label(m, m.start, m.start + half, a));
        out.push(label(m, m.start + half, end, b));
        continue;
      }
    }
    if (w && w.fit >= MIN_CONFIDENCE) out.push(label(m, m.start, end, w));
  }
  return out;
}

/**
 * 一段小节里的和弦序列（送到进行练习器的自定义序列）：按演奏顺序，相邻相同的合并。
 * order 为演奏顺序（反复记号已展开）里的小节下标。
 */
export function chordSequence(labels: readonly ChordLabel[], order: readonly number[]): string[] {
  const byMeasure = new Map<number, ChordLabel[]>();
  for (const l of labels) {
    const list = byMeasure.get(l.measure);
    if (list) list.push(l);
    else byMeasure.set(l.measure, [l]);
  }
  const out: string[] = [];
  for (const m of order) {
    for (const l of byMeasure.get(m) ?? []) {
      if (out[out.length - 1] !== l.text) out.push(l.text);
    }
  }
  return out;
}
