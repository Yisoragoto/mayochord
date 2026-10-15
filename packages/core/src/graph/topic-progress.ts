import type { Rating, ReviewLog } from '../log/review-log';
import { type CardMemory, DEFAULT_FSRS, type FsrsParams, reviewMemory } from '../scheduler/memory';
import { type DayParams, dayKey } from '../scheduler/progress';
import type { TopicGraph } from './topic-graph';

/**
 * 主题级的作答日志（ReviewLog，cardKind = 'topic'，cardId = topic:<id>）：
 * - drillType 'lesson'         开始/推进课程（rating 为 null，只表示"学习中"）
 * - drillType 'mastery-check'  掌握检查：通过（correct）时 rating 有值，作为主题的第一次复习
 * - drillType 'topic-review'   每日任务里对这个主题的复习（rating 由正确率得出）
 * - drillType 'quiz'           测验里这个主题的成绩（M6，与复习一样记入主题记忆）
 * - drillType 'diagnostic'     诊断测试推断为已掌握（M6，与通过掌握检查一样，rating 通常为 Hard）
 * - evidence 'implicit'        隐式重复：练包含它的上层主题得到的部分信用（weight 0–1）；
 *                              correct = false 表示底层失败传给上层的负信用
 */
export const TOPIC_CARD_PREFIX = 'topic:';
export const topicCardId = (topicId: string) => `${TOPIC_CARD_PREFIX}${topicId}`;

export type TopicLogType = 'lesson' | 'mastery-check' | 'diagnostic' | 'topic-review' | 'quiz';

export interface TopicProgress {
  topicId: string;
  memory: CardMemory | null;
  lastScheduledDay: string | null;
  /** 累积的隐式正信用（满 1 记一次 Good） */
  credit: number;
  /** 累积的隐式负信用（满 1 记一次 Hard） */
  penalty: number;
  lessonStartedAt: number | null;
  /** 第一次通过掌握检查的时间 */
  masteredAt: number | null;
  /** 掌握后隔天再次通过复习的时间（规格 6.6"间隔一天后仍能通过"） */
  confirmedAt: number | null;
  lastReviewAt: number | null;
}

export interface TopicProgressParams {
  fsrs: FsrsParams;
  day: DayParams;
  /** 隐式信用来得过早时的最低折扣（elapsed / interval 的下限） */
  minEarlyFactor: number;
}

export const DEFAULT_TOPIC_PROGRESS: TopicProgressParams = {
  fsrs: DEFAULT_FSRS,
  day: { dayStartHour: 4, tzOffsetMinutes: 0 },
  minEarlyFactor: 0.1,
};

export function emptyTopicProgress(topicId: string): TopicProgress {
  return {
    topicId,
    memory: null,
    lastScheduledDay: null,
    credit: 0,
    penalty: 0,
    lessonStartedAt: null,
    masteredAt: null,
    confirmedAt: null,
    lastReviewAt: null,
  };
}

function review(
  p: TopicProgress,
  rating: Rating,
  ts: number,
  params: TopicProgressParams,
): TopicProgress {
  const day = dayKey(ts, params.day);
  if (day === p.lastScheduledDay) return { ...p, lastReviewAt: ts };
  return {
    ...p,
    memory: reviewMemory(p.memory, rating, ts, params.fsrs),
    lastScheduledDay: day,
    lastReviewAt: ts,
  };
}

/** 用一条主题日志更新主题进度。 */
export function applyTopicLog(
  p: TopicProgress,
  log: ReviewLog,
  params: TopicProgressParams = DEFAULT_TOPIC_PROGRESS,
): TopicProgress {
  if (log.cardId !== topicCardId(p.topicId)) return p;

  if (log.evidence === 'implicit') {
    // 还没学过的主题不接收隐式信用
    if (!p.memory || p.masteredAt === null) return p;
    if (log.correct) {
      // 复习信用来得过早时打折扣：距上次复习的天数 / 当前间隔
      const elapsedDays = (log.ts - (p.memory.lastReview ?? log.ts)) / 86_400_000;
      const interval = Math.max(1, p.memory.scheduledDays);
      const factor = Math.min(1, Math.max(params.minEarlyFactor, elapsedDays / interval));
      let next: TopicProgress = { ...p, credit: p.credit + log.weight * factor };
      if (next.credit >= 1) next = { ...review(next, 3, log.ts, params), credit: next.credit - 1 };
      return next;
    }
    let next: TopicProgress = { ...p, penalty: p.penalty + log.weight };
    if (next.penalty >= 1) next = { ...review(next, 2, log.ts, params), penalty: next.penalty - 1 };
    return next;
  }

  switch (log.drillType as TopicLogType) {
    case 'lesson':
      return p.lessonStartedAt === null ? { ...p, lessonStartedAt: log.ts } : p;
    case 'mastery-check':
    case 'diagnostic': {
      if (!log.correct || log.rating === null) {
        return { ...p, lessonStartedAt: p.lessonStartedAt ?? log.ts };
      }
      const next = review(p, log.rating, log.ts, params);
      return {
        ...next,
        lessonStartedAt: p.lessonStartedAt ?? log.ts,
        masteredAt: p.masteredAt ?? log.ts,
        credit: 0,
        penalty: 0,
      };
    }
    case 'topic-review':
    case 'quiz': {
      if (log.rating === null) return p;
      const next = { ...review(p, log.rating, log.ts, params), credit: 0, penalty: 0 };
      const laterDay =
        p.masteredAt !== null && dayKey(log.ts, params.day) !== dayKey(p.masteredAt, params.day);
      if (log.correct && laterDay && p.confirmedAt === null) next.confirmedAt = log.ts;
      return next;
    }
    default:
      return p;
  }
}

export function replayTopicProgress(
  topicId: string,
  logs: readonly ReviewLog[],
  params: TopicProgressParams = DEFAULT_TOPIC_PROGRESS,
): TopicProgress {
  return logs.reduce((p, l) => applyTopicLog(p, l, params), emptyTopicProgress(topicId));
}

/**
 * 主题状态（图谱页的颜色）：
 * - locked     未解锁：有先修主题还没通过掌握检查
 * - available  可学习：先修都已掌握，还没开始
 * - learning   学习中：开始了课程，还没通过掌握检查
 * - mastered   已掌握：通过了掌握检查，还没到复习时间
 * - review     需复习：已掌握，记忆到期
 */
export type TopicStatus = 'locked' | 'available' | 'learning' | 'mastered' | 'review';

export function topicStatus(
  graph: TopicGraph,
  progress: ReadonlyMap<string, TopicProgress>,
  topicId: string,
  now: number,
): TopicStatus {
  const p = progress.get(topicId);
  if (p?.masteredAt != null) return p.memory && p.memory.due <= now ? 'review' : 'mastered';
  const prereqs = graph.byId.get(topicId)?.prerequisites ?? [];
  const unlocked = prereqs.every((id) => progress.get(id)?.masteredAt != null);
  if (!unlocked) return 'locked';
  return p?.lessonStartedAt != null ? 'learning' : 'available';
}

export function topicStatuses(
  graph: TopicGraph,
  progress: ReadonlyMap<string, TopicProgress>,
  now: number,
): Map<string, TopicStatus> {
  return new Map(graph.order.map((id) => [id, topicStatus(graph, progress, id, now)]));
}
