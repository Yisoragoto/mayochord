import type { Rating } from '../log/review-log';
import { TPQ } from '../score/model';

/**
 * 节奏读谱（M10，规格第 13 节 M10）：看一小节节奏，跟着节拍器在任意键上按出每个音的起点。
 *
 * 节奏型写成一串记号，用空格分开：
 * - 时值：w h q 8 16 = 全音符、二分、四分、八分、十六分
 * - `.` 附点（可以两个）；`r` 休止符；`t` 三连音（三个 8t 占一拍）；`~` 连到下一个音（下一个音不按）
 * 例如 'q. 8 q q'、'8 8~8 8 q qr'。
 */

export type RhythmBase = 'w' | 'h' | 'q' | '8' | '16';

export interface RhythmToken {
  base: RhythmBase;
  dots: number;
  rest: boolean;
  triplet: boolean;
  /** 连到下一个音 */
  tie: boolean;
  /** 在小节里的开始、时值（tick，四分音符 = TPQ） */
  start: number;
  dur: number;
}

export interface RhythmPattern {
  tokens: RhythmToken[];
  /** 需要按下的起点（tick）：不是休止符、也不是被连音线连过来的音 */
  onsets: number[];
  /** 小节长度（tick） */
  length: number;
}

const BASE_TICKS: Record<RhythmBase, number> = {
  w: TPQ * 4,
  h: TPQ * 2,
  q: TPQ,
  '8': TPQ / 2,
  '16': TPQ / 4,
};

const TOKEN = /^(w|h|q|8|16)(t?)(\.{0,2})(r?)(~?)$/;

/** 解析节奏型；记号不对、总时值和拍号不符时抛出错误（内容包校验会捕获） */
export function parseRhythm(notes: string, time: readonly [number, number]): RhythmPattern {
  const [beats, beatType] = time;
  const length = (beats * 4 * TPQ) / beatType;
  const tokens: RhythmToken[] = [];
  let t = 0;
  for (const raw of notes.trim().split(/\s+/)) {
    const m = TOKEN.exec(raw);
    if (!m) throw new Error(`无法识别的节奏记号：${raw}`);
    const base = m[1] as RhythmBase;
    const triplet = m[2] === 't';
    const dots = (m[3] ?? '').length;
    let dur = BASE_TICKS[base];
    if (triplet) dur = (dur * 2) / 3;
    let add = dur / 2;
    for (let i = 0; i < dots; i++) {
      dur += add;
      add /= 2;
    }
    tokens.push({ base, dots, rest: m[4] === 'r', triplet, tie: m[5] === '~', start: t, dur });
    t += dur;
  }
  if (Math.abs(t - length) > 1e-6) {
    throw new Error(`节奏型的总时值（${t / TPQ} 拍）与拍号 ${beats}/${beatType} 不符`);
  }
  const last = tokens[tokens.length - 1];
  if (last?.tie) throw new Error('最后一个音不能有连音线');
  const onsets: number[] = [];
  tokens.forEach((tok, i) => {
    const prev = tokens[i - 1];
    if (tok.rest) return;
    if (prev?.tie && !prev.rest) return;
    onsets.push(tok.start);
  });
  return { tokens, onsets, length };
}

export interface RhythmHit {
  /** 谱上起点（毫秒，相对小节开始） */
  expected: number;
  /** 配对到的按键（毫秒，相对小节开始，已扣延迟校准）；漏按为 null */
  tap: number | null;
  offset: number | null;
  onBeat: boolean;
}

export interface RhythmJudge {
  hits: RhythmHit[];
  /** 配不上的按键（多按） */
  extra: number[];
  missed: number;
  /** 没有漏按、没有多按 */
  correct: boolean;
  /** 弹对且每一下都在拍上 */
  clean: boolean;
}

/**
 * 判定一小节：每个起点与时间最近、还没配对、距离在 window 内的按键配对。
 * window = 与相邻起点间隔的一半（至少 60 ms），并且不超过 maxWindowMs。
 */
export function judgeRhythm(
  expected: readonly number[],
  taps: readonly number[],
  toleranceMs: number,
  maxWindowMs = 250,
): RhythmJudge {
  const used = new Set<number>();
  const hits: RhythmHit[] = expected.map((e, i) => {
    const gaps = [expected[i - 1], expected[i + 1]]
      .filter((x): x is number => x !== undefined)
      .map((x) => Math.abs(x - e));
    const window = Math.min(maxWindowMs, Math.max(60, Math.min(Infinity, ...gaps) / 2));
    let best: number | null = null;
    taps.forEach((tap, j) => {
      if (used.has(j) || Math.abs(tap - e) > window) return;
      if (best === null || Math.abs(tap - e) < Math.abs((taps[best] as number) - e)) best = j;
    });
    if (best === null) return { expected: e, tap: null, offset: null, onBeat: false };
    used.add(best);
    const tap = taps[best] as number;
    const offset = tap - e;
    return { expected: e, tap, offset, onBeat: Math.abs(offset) <= toleranceMs };
  });
  const extra = taps.filter((_, j) => !used.has(j));
  const missed = hits.filter((h) => h.tap === null).length;
  const correct = missed === 0 && extra.length === 0;
  return { hits, extra, missed, correct, clean: correct && hits.every((h) => h.onBeat) };
}

/** 评分（与跟拍弹进行一致）：错 Again；全部在拍上 Good；否则 Hard；看了示范最多 Hard */
export function gradeRhythm(j: RhythmJudge, hintUsed: boolean): Rating {
  if (!j.correct) return 1;
  if (!j.clean || hintUsed) return 2;
  return 3;
}
