import type { InputSourceKind, Rating, ReviewLog } from '../log/review-log';

/**
 * 自动评分（规格 6.4）。参数集中在 GradingParams，由调度策略提供。
 *
 * - 错误或超时 → Again(1)
 * - 正确，反应时间 > 个人中位数 × hardFactor → Hard(2)
 * - 正确，反应时间 < 个人中位数 × easyFactor → Easy(4)
 * - 正确，速度正常 → Good(3)
 * - 使用了提示 → 最多 Hard
 * - MIDI 输入且没有同时落下（齐整度超出窗口）→ 最多 Hard（第 11 节过关标准"和弦的音同时落下"）
 * - 个人历史不足 minHistory 条时没有可靠的中位数：正确记为 Good
 */
export interface GradingParams {
  hardFactor: number;
  easyFactor: number;
  /** 计算个人中位数至少需要的历史条数 */
  minHistory: number;
  /** 计算个人中位数最多取最近多少条 */
  historyWindow: number;
  hintCap: Rating;
  notTogetherCap: Rating;
}

export const DEFAULT_GRADING: GradingParams = {
  hardFactor: 1.5,
  easyFactor: 0.6,
  minHistory: 5,
  historyWindow: 50,
  hintCap: 2,
  notTogetherCap: 2,
};

export interface GradeInput {
  correct: boolean;
  timedOut: boolean;
  reactionMs: number | null;
  hintUsed: boolean;
  together: boolean | null;
}

export function gradeEvidence(
  e: GradeInput,
  personalMedianMs: number | null,
  params: GradingParams = DEFAULT_GRADING,
): Rating {
  if (!e.correct || e.timedOut) return 1;
  let rating: Rating = 3;
  if (personalMedianMs !== null && e.reactionMs !== null) {
    if (e.reactionMs > personalMedianMs * params.hardFactor) rating = 2;
    else if (e.reactionMs < personalMedianMs * params.easyFactor) rating = 4;
  }
  if (e.hintUsed) rating = Math.min(rating, params.hintCap) as Rating;
  if (e.together === false) rating = Math.min(rating, params.notTogetherCap) as Rating;
  return rating;
}

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/**
 * 个人反应时间中位数：同一练习类型、同一类输入源（MIDI 与屏幕键盘速度差别很大）
 * 最近 historyWindow 条"正确、无提示"的显式日志。不足 minHistory 条时返回 null。
 * logs 按时间升序。
 */
export function personalMedian(
  logs: readonly ReviewLog[],
  filter: { drillType: string; inputSource: InputSourceKind },
  params: GradingParams = DEFAULT_GRADING,
): number | null {
  const times: number[] = [];
  for (let i = logs.length - 1; i >= 0 && times.length < params.historyWindow; i--) {
    const l = logs[i] as ReviewLog;
    if (
      l.evidence === 'explicit' &&
      l.correct &&
      !l.hintUsed &&
      l.reactionMs !== null &&
      l.drillType === filter.drillType &&
      l.inputSource === filter.inputSource
    ) {
      times.push(l.reactionMs);
    }
  }
  return times.length >= params.minHistory ? median(times) : null;
}
