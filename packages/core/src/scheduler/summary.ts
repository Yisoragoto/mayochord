import type { Evidence } from '../drill/drill';

/**
 * 轮次总结（规格 6.7）：正确率、最慢的和弦、最慢的切换、齐整度。
 * "最慢"按每张卡答对时反应时间的平均值比较；齐整度只统计 MIDI 输入。
 */
export interface CardSpeed {
  cardId: string;
  meanReactionMs: number;
  count: number;
}

export interface SessionSummary {
  total: number;
  correct: number;
  accuracy: number;
  timedOut: number;
  hintsUsed: number;
  meanReactionMs: number | null;
  slowestChord: CardSpeed | null;
  slowestTransition: CardSpeed | null;
  /** 答对的 MIDI 作答的平均齐整度 */
  meanSpreadMs: number | null;
  /** 答对但没有同时落下的次数 */
  notTogether: number;
  bestStreak: number;
}

const mean = (xs: readonly number[]) =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

function slowest(evidence: readonly Evidence[], kind: Evidence['cardKind']): CardSpeed | null {
  const times = new Map<string, number[]>();
  for (const e of evidence) {
    if (e.cardKind !== kind || !e.correct || e.reactionMs === null) continue;
    const list = times.get(e.cardId) ?? [];
    list.push(e.reactionMs);
    times.set(e.cardId, list);
  }
  let best: CardSpeed | null = null;
  for (const [cardId, list] of times) {
    const m = mean(list) as number;
    if (!best || m > best.meanReactionMs) best = { cardId, meanReactionMs: m, count: list.length };
  }
  return best;
}

export function summarizeSession(evidence: readonly Evidence[]): SessionSummary {
  const correct = evidence.filter((e) => e.correct);
  let streak = 0;
  let bestStreak = 0;
  for (const e of evidence) {
    streak = e.correct ? streak + 1 : 0;
    bestStreak = Math.max(bestStreak, streak);
  }
  const spreads = correct.flatMap((e) => (e.spreadMs === null ? [] : [e.spreadMs]));
  return {
    total: evidence.length,
    correct: correct.length,
    accuracy: evidence.length === 0 ? 0 : correct.length / evidence.length,
    timedOut: evidence.filter((e) => e.timedOut).length,
    hintsUsed: evidence.filter((e) => e.hintUsed).length,
    meanReactionMs: mean(correct.flatMap((e) => (e.reactionMs === null ? [] : [e.reactionMs]))),
    slowestChord: slowest(evidence, 'chord'),
    slowestTransition: slowest(evidence, 'transition'),
    meanSpreadMs: mean(spreads),
    notTogether: correct.filter((e) => e.together === false).length,
    bestStreak,
  };
}
