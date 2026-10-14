import { isBlackKey, type JudgeResult, type Voicing, voicingMidi } from '@mayochord/core';
import type { KeyMark } from '@/design/keyboard/Keyboard';

/** 参考键位 → 键盘上的目标标记（左右手颜色 + 指法数字）。 */
export function referenceMarks(v: Voicing): Map<number, KeyMark> {
  const marks = new Map<number, KeyMark>();
  for (const n of v.notes) {
    const mark: KeyMark = { kind: 'target', hand: n.hand };
    if (n.finger !== undefined) mark.finger = n.finger;
    marks.set(n.midi, mark);
  }
  return marks;
}

/** 能完整显示这些音的键盘范围：两边各留 pad 个半音，并让两端落在白键上。 */
export function keyboardRange(notes: readonly number[], pad = 2): { low: number; high: number } {
  let low = Math.min(...notes) - pad;
  let high = Math.max(...notes) + pad;
  if (isBlackKey(low)) low -= 1;
  if (isBlackKey(high)) high += 1;
  return { low, high };
}

/** 一组键位共用的键盘范围（同一组卡片对齐显示）。 */
export function sharedRange(voicings: readonly Voicing[], pad = 2) {
  return keyboardRange(
    voicings.flatMap((v) => voicingMidi(v)),
    pad,
  );
}

/**
 * 判定结果 → 键盘标记：按对的、多按的（在按下的键上），少按的（标在参考键位上，带指法）。
 */
export function judgeMarks(
  reference: Voicing,
  played: readonly number[],
  judge: JudgeResult,
): Map<number, KeyMark> {
  const ref = new Map(reference.notes.map((n) => [n.midi, n]));
  const marks = new Map<number, KeyMark>();
  const extra = new Set(judge.extra);
  for (const n of played) {
    const hand = ref.get(n)?.hand;
    marks.set(n, extra.has(n) ? { kind: 'extra' } : { kind: 'correct', ...(hand ? { hand } : {}) });
  }
  for (const n of judge.missing) {
    const v = ref.get(n);
    const mark: KeyMark = { kind: 'missing' };
    if (v?.hand) mark.hand = v.hand;
    if (v?.finger !== undefined) mark.finger = v.finger;
    marks.set(n, mark);
  }
  return marks;
}
