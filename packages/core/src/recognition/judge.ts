import { pitchClass } from '../theory/notes';

/**
 * 判定模式（规格第 8 节）：
 * - loose 宽松：比较音级集合，忽略八度和转位
 * - strict 严格：必须与参考键位的每个音完全一致
 */
export type JudgeMode = 'loose' | 'strict';

export interface JudgeResult {
  correct: boolean;
  /** 多按的音（按住的 MIDI 号） */
  extra: number[];
  /** 少按的音（参考键位里的 MIDI 号，用于在键盘上标出应该按的位置） */
  missing: number[];
}

/** 比较按住的音与目标（参考键位）。 */
export function judgeNotes(
  held: readonly number[],
  target: readonly number[],
  mode: JudgeMode,
): JudgeResult {
  const sortAsc = (xs: number[]) => xs.sort((a, b) => a - b);
  if (mode === 'strict') {
    const h = new Set(held);
    const t = new Set(target);
    const extra = sortAsc([...h].filter((n) => !t.has(n)));
    const missing = sortAsc([...t].filter((n) => !h.has(n)));
    return {
      correct: extra.length === 0 && missing.length === 0 && held.length > 0,
      extra,
      missing,
    };
  }
  const heldPcs = new Set(held.map(pitchClass));
  const targetPcs = new Set(target.map(pitchClass));
  const extra = sortAsc([...new Set(held)].filter((n) => !targetPcs.has(pitchClass(n))));
  const missing = sortAsc([...new Set(target)].filter((n) => !heldPcs.has(pitchClass(n))));
  return { correct: extra.length === 0 && missing.length === 0 && held.length > 0, extra, missing };
}

/**
 * 按住的音整体平移 k 个半音后与目标完全一致（k ≠ 0）时返回 k，否则返回 null。
 * 用于提示“琴上的 OCTAVE / TRANSPOSE 可能被改动了，请重新校准”。
 */
export function findUniformShift(
  held: readonly number[],
  target: readonly number[],
  maxShift = 36,
): number | null {
  if (held.length === 0 || held.length !== target.length) return null;
  const h = [...held].sort((a, b) => a - b);
  const t = [...target].sort((a, b) => a - b);
  const k = (h[0] as number) - (t[0] as number);
  if (k === 0 || Math.abs(k) > maxShift) return null;
  return h.every((n, i) => n - (t[i] as number) === k) ? k : null;
}
