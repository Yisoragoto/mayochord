import type { ReviewLog } from '../log/review-log';
import { type CardMemory, DEFAULT_FSRS, type FsrsParams, reviewMemory } from './memory';

/**
 * 新卡三阶段（规格 6.4）：
 * - focused 集中练：同一张卡连续出现（分块练习）
 * - ordered 按顺序：在进行/和弦组里按原有顺序出现
 * - mixed   随机混合：打乱顺序，和其他卡交错
 * 连续 N 次"达标"进入下一阶段；达标 = 正确、没用提示、评分至少 Good。答错连续次数清零（阶段不倒退）。
 */
export type CardPhase = 'focused' | 'ordered' | 'mixed';

export interface PhaseParams {
  /** focused → ordered 需要的连续达标次数 */
  focusedPasses: number;
  /** ordered → mixed 需要的连续达标次数 */
  orderedPasses: number;
}

export const DEFAULT_PHASES: PhaseParams = { focusedPasses: 3, orderedPasses: 3 };

export interface DayParams {
  /** 一天从几点开始（凌晨练琴算前一天） */
  dayStartHour: number;
  /** 本地时区偏移（Date#getTimezoneOffset，分钟，东八区为 -480） */
  tzOffsetMinutes: number;
}

/** 卡片的学习进度：全部由作答日志重放得到，存进 cardStates 表只是缓存。 */
export interface CardProgress {
  cardId: string;
  memory: CardMemory | null;
  phase: CardPhase;
  streak: number;
  /** 显式作答总数、答对数 */
  attempts: number;
  correct: number;
  /** 最后一次作答时间（Unix 毫秒） */
  lastSeen: number | null;
  /** 最近一次更新 FSRS 的"天"（dayKey） */
  lastScheduledDay: string | null;
}

export interface ProgressParams {
  phases: PhaseParams;
  fsrs: FsrsParams;
  day: DayParams;
}

export const DEFAULT_PROGRESS: ProgressParams = {
  phases: DEFAULT_PHASES,
  fsrs: DEFAULT_FSRS,
  day: { dayStartHour: 4, tzOffsetMinutes: 0 },
};

/** 时间戳所属的"练习日"，例如 '2026-10-14'。 */
export function dayKey(ts: number, day: DayParams): string {
  const local = ts - day.tzOffsetMinutes * 60_000 - day.dayStartHour * 3_600_000;
  return new Date(local).toISOString().slice(0, 10);
}

export function emptyProgress(cardId: string): CardProgress {
  return {
    cardId,
    memory: null,
    phase: 'focused',
    streak: 0,
    attempts: 0,
    correct: 0,
    lastSeen: null,
    lastScheduledDay: null,
  };
}

export function isPass(log: Pick<ReviewLog, 'correct' | 'hintUsed' | 'rating'>): boolean {
  return log.correct && !log.hintUsed && log.rating !== null && log.rating >= 3;
}

/**
 * 用一条作答日志更新进度。只处理该卡片的显式、已评分日志。
 * FSRS 只用每个练习日里第一次评分：同一天之内的重复属于练习内学习，
 * 不应让间隔在一天之内被反复拉长或缩短。
 */
export function applyLog(
  p: CardProgress,
  log: ReviewLog,
  params: ProgressParams = DEFAULT_PROGRESS,
): CardProgress {
  if (log.cardId !== p.cardId || log.evidence !== 'explicit' || log.rating === null) return p;
  const next: CardProgress = {
    ...p,
    attempts: p.attempts + 1,
    correct: p.correct + (log.correct ? 1 : 0),
    lastSeen: log.ts,
  };

  const day = dayKey(log.ts, params.day);
  if (day !== p.lastScheduledDay) {
    next.memory = reviewMemory(p.memory, log.rating, log.ts, params.fsrs);
    next.lastScheduledDay = day;
  }

  if (isPass(log)) {
    next.streak = p.streak + 1;
    const need =
      p.phase === 'focused'
        ? params.phases.focusedPasses
        : p.phase === 'ordered'
          ? params.phases.orderedPasses
          : Number.POSITIVE_INFINITY;
    if (next.streak >= need) {
      next.phase = p.phase === 'focused' ? 'ordered' : 'mixed';
      next.streak = 0;
    }
  } else {
    next.streak = 0;
  }
  return next;
}

/** 从日志重建一张卡片的进度（logs 按时间升序）。 */
export function replayProgress(
  cardId: string,
  logs: readonly ReviewLog[],
  params: ProgressParams = DEFAULT_PROGRESS,
): CardProgress {
  return logs.reduce((p, l) => applyLog(p, l, params), emptyProgress(cardId));
}

/** 卡片是否到期（新卡不算到期，由新内容的规则引入）。 */
export function isDue(p: CardProgress, now: number): boolean {
  return p.memory !== null && p.memory.state !== 'new' && p.memory.due <= now;
}
