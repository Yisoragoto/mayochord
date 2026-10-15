import { parseNoteName } from '../theory';
import type { Hand, NotationElement, ScoreMeasure, ScoreNote } from './model';

const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** 调号里每个字母的升降（fifths：正 = 升号个数，负 = 降号个数） */
export function keyAlterations(fifths: number): Record<string, number> {
  const out: Record<string, number> = {};
  const n = Math.min(7, Math.abs(fifths));
  const order = fifths >= 0 ? SHARP_ORDER : FLAT_ORDER;
  for (let i = 0; i < n; i++) out[order[i] as string] = fifths >= 0 ? 1 : -1;
  return out;
}

const ACC_SYMBOL: Record<number, string> = { [-2]: 'bb', [-1]: 'b', 0: 'n', 1: '#', 2: '##' };

/**
 * 计算每个音要不要画临时记号：小节开始时按调号，同一小节、同一谱表、同一八度的同一字母
 * 之后沿用前面的临时记号。连音线延续过来的音不画。
 */
export function assignAccidentals(
  elements: NotationElement[],
  measures: readonly ScoreMeasure[],
): void {
  const groups = new Map<string, NotationElement[]>();
  for (const el of elements) {
    if (el.rest) continue;
    const key = `${el.measure}:${el.staff}`;
    const g = groups.get(key);
    if (g) g.push(el);
    else groups.set(key, [el]);
  }
  for (const group of groups.values()) {
    const first = group[0] as NotationElement;
    const keyAlter = keyAlterations(measures[first.measure]?.fifths ?? 0);
    const state = new Map<string, number>();
    group.sort((a, b) => a.start - b.start);
    for (const el of group) {
      for (const p of el.pitches) {
        const n = parseNoteName(p.spelled);
        if (!n) continue;
        const slot = `${n.letter}${n.octave}`;
        const current = state.get(slot) ?? keyAlter[n.letter] ?? 0;
        if (p.tieStop) {
          p.accidental = null;
          continue;
        }
        p.accidental = n.alter === current ? null : (ACC_SYMBOL[n.alter] ?? null);
        state.set(slot, n.alter);
      }
    }
  }
}

/**
 * 由记谱元素生成演奏用的音：按时间排序、给每个音编号，连音线把后半段并到前半段的音上。
 * 会改写 elements（排序、填 noteId）。
 */
export function buildNotes(elements: NotationElement[], staffHands: readonly Hand[]): ScoreNote[] {
  elements.sort((a, b) => a.start - b.start || a.staff - b.staff);
  const notes: ScoreNote[] = [];
  /** `${staff}:${pitch}` → 等待连音线后半段的音 */
  const open = new Map<string, ScoreNote>();
  for (const el of elements) {
    el.pitches.sort((a, b) => a.pitch - b.pitch);
    for (const p of el.pitches) {
      const key = `${el.staff}:${p.pitch}`;
      const tied = p.tieStop ? open.get(key) : undefined;
      if (tied) {
        tied.dur = Math.max(tied.dur, el.start + el.dur - tied.start);
        p.noteId = tied.id;
        if (!p.tieStart) open.delete(key);
        continue;
      }
      const note: ScoreNote = {
        id: notes.length,
        pitch: p.pitch,
        start: el.start,
        dur: el.dur,
        hand: staffHands[el.staff - 1] ?? 'left',
        measure: el.measure,
      };
      notes.push(note);
      p.noteId = note.id;
      if (p.tieStart) open.set(key, note);
      else open.delete(key);
    }
  }
  return notes;
}
