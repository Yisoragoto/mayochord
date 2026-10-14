import type { Rating } from '../log/review-log';

/**
 * 主题级评分：一次练习里这个主题的若干道题 → 一个评分（写进主题日志、更新主题记忆）。
 * - 正确率 < 75% → Again；< 90% → Hard；
 * - ≥ 90% 且各题平均评分 ≥ 3.5 → Easy，否则 Good。
 */
export interface TopicGradingParams {
  againBelow: number;
  hardBelow: number;
  easyMeanRating: number;
}

export const DEFAULT_TOPIC_GRADING: TopicGradingParams = {
  againBelow: 0.75,
  hardBelow: 0.9,
  easyMeanRating: 3.5,
};

export function topicRating(
  results: readonly { correct: boolean; rating: Rating | null }[],
  params: TopicGradingParams = DEFAULT_TOPIC_GRADING,
): Rating | null {
  if (results.length === 0) return null;
  const accuracy = results.filter((r) => r.correct).length / results.length;
  if (accuracy < params.againBelow) return 1;
  if (accuracy < params.hardBelow) return 2;
  const rated = results.flatMap((r) => (r.rating === null ? [] : [r.rating]));
  const mean = rated.length === 0 ? 3 : rated.reduce((a, b) => a + b, 0) / rated.length;
  return mean >= params.easyMeanRating ? 4 : 3;
}

/** 掌握检查（规格 6.2/6.6）：限时、无提示，正确率达到 minAccuracy 才算通过。 */
export function masteryPassed(
  results: readonly { correct: boolean }[],
  minAccuracy: number,
  minQuestions = 1,
): boolean {
  if (results.length < minQuestions) return false;
  return results.filter((r) => r.correct).length / results.length >= minAccuracy;
}
