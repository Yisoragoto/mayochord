import { BUILTIN_PACK, type TopicEntry } from '@mayochord/content';
import type { AnyCard } from '@mayochord/core';
import type { SessionSpec } from '../practice/controller';

/** 从一组卡片里均匀挑 n 张（引导练习覆盖整个主题，而不是只练前几张） */
export function spread<T>(items: readonly T[], n: number): T[] {
  if (items.length <= n) return [...items];
  const step = items.length / n;
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)] as T);
}

/** 课程第 2 步：引导练习。每题都显示键位，按顺序每张一次，不限时 */
export function guidedSpec(topic: TopicEntry): SessionSpec {
  const cards = spread(topic.cards, topic.lesson.guided.count);
  return {
    kind: 'guided',
    cards,
    length: cards.length,
    order: 'sequential',
    hints: 'always',
    retryWrong: false,
    requireCorrection: true,
    config: { topicId: topic.id },
  };
}

/** 课程第 3 步：独立练习。不显示提示（答错、超时才显示），首次答对 requiredCorrect 题为止 */
export function independentSpec(topic: TopicEntry): SessionSpec {
  const n = topic.lesson.independent.requiredCorrect;
  return {
    kind: 'independent',
    cards: topic.cards,
    length: n * 3,
    order: 'mixed',
    hints: 'auto',
    targetCorrect: n,
    retryWrong: true,
    requireCorrection: true,
    config: { topicId: topic.id },
  };
}

/** 课程第 4 步：掌握检查。限时、不能看提示、答错不重做 */
export function masterySpec(topic: TopicEntry): SessionSpec {
  const m = topic.lesson.mastery;
  return {
    kind: 'mastery',
    cards: topic.cards,
    length: m.questions,
    order: 'mixed',
    hints: 'never',
    fixedTimeLimitMs: m.timeLimitMs,
    retryWrong: false,
    requireCorrection: false,
    config: { topicId: topic.id },
  };
}

/** 测验、诊断用的固定时限：这些卡片所属主题的掌握检查时限里最长的 */
export function checkTimeLimit(cards: readonly AnyCard[]): number {
  const limits = cards.flatMap((c) =>
    (BUILTIN_PACK.topicsOfCard.get(c.id) ?? []).map(
      (id) => BUILTIN_PACK.topicById.get(id)?.lesson.mastery.timeLimitMs ?? 6000,
    ),
  );
  return limits.length > 0 ? Math.max(...limits) : 6000;
}

/**
 * 每日任务：热身 / 针对性补救 / 复习（交错，答错几题后重做）/
 * 测验（限时、不能看提示、答错不重做，规格 6.6）
 */
export function taskSpec(
  kind: 'warmup' | 'remediation' | 'review' | 'quiz',
  cards: readonly AnyCard[],
  config: Record<string, unknown>,
): SessionSpec {
  if (kind === 'quiz') {
    return {
      kind,
      cards,
      length: cards.length,
      order: 'sequential',
      hints: 'never',
      fixedTimeLimitMs: checkTimeLimit(cards),
      retryWrong: false,
      requireCorrection: false,
      config,
    };
  }
  if (kind === 'remediation') {
    // 每张卡至少练两遍：先回忆，答错马上看提示改正，几题后再出现
    return {
      kind,
      cards,
      length: cards.length * 2,
      order: 'mixed',
      hints: 'auto',
      retryWrong: true,
      requireCorrection: true,
      config,
    };
  }
  return {
    kind,
    cards,
    length: kind === 'review' ? cards.length + 3 : cards.length,
    order: 'mixed',
    hints: 'auto',
    retryWrong: true,
    requireCorrection: true,
    config,
  };
}
