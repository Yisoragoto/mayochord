import { pitchClass } from '../theory/notes';

/**
 * 判定模式（规格第 8 节）：
 * - loose 宽松：比较音级集合，忽略八度和转位
 * - strict 严格：必须与参考键位的每个音完全一致
 * - bass 低音：宽松 + 最低音的音级必须与参考键位的最低音相同（音程题、转位/斜杠和弦题）
 */
export type JudgeMode = 'loose' | 'strict' | 'bass';

export interface JudgeResult {
  correct: boolean;
  /** 多按的音（按住的 MIDI 号） */
  extra: number[];
  /** 少按的音（参考键位里的 MIDI 号，用于在键盘上标出应该按的位置） */
  missing: number[];
  /** bass 模式：音都对，但最低音不对（应为参考键位的最低音） */
  wrongBass?: boolean;
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
  const pcsOk = extra.length === 0 && missing.length === 0 && held.length > 0;
  if (mode === 'bass' && pcsOk) {
    const lowest = (xs: readonly number[]) => Math.min(...xs);
    if (pitchClass(lowest(held)) !== pitchClass(lowest(target))) {
      return { correct: false, extra, missing, wrongBass: true };
    }
  }
  return { correct: pcsOk, extra, missing };
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
