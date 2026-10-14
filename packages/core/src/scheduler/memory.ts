import { type Card, createEmptyCard, type FSRS, fsrs, type Grade, State } from 'ts-fsrs';
import type { Rating } from '../log/review-log';

/**
 * 卡片记忆状态（FSRS）。为了能存进 IndexedDB 和比较，时间一律用 Unix 毫秒。
 */
export interface CardMemory {
  due: number;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: 'new' | 'learning' | 'review' | 'relearning';
  lastReview: number | null;
}

export interface FsrsParams {
  /** 目标记忆保持率 */
  requestRetention: number;
  /** 最长间隔（天） */
  maximumInterval: number;
  /** 间隔随机抖动（避免同一天学的卡片总在同一天到期） */
  enableFuzz: boolean;
}

export const DEFAULT_FSRS: FsrsParams = {
  requestRetention: 0.9,
  maximumInterval: 365,
  enableFuzz: false,
};

const STATE_NAMES = ['new', 'learning', 'review', 'relearning'] as const;
const STATE_ENUM: Record<CardMemory['state'], State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

const schedulers = new Map<string, FSRS>();

/**
 * 按天调度：关闭 FSRS 的短期学习步骤（1 分钟、10 分钟）。
 * 一次练习之内的重复由练习会话自己安排（答错的卡 3–5 题后再出现），不交给 FSRS。
 */
function scheduler(p: FsrsParams): FSRS {
  const key = `${p.requestRetention}|${p.maximumInterval}|${p.enableFuzz}`;
  let f = schedulers.get(key);
  if (!f) {
    f = fsrs({
      request_retention: p.requestRetention,
      maximum_interval: p.maximumInterval,
      enable_fuzz: p.enableFuzz,
      enable_short_term: false,
    });
    schedulers.set(key, f);
  }
  return f;
}

function fromCard(c: Card): CardMemory {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: STATE_NAMES[c.state],
    lastReview: c.last_review ? c.last_review.getTime() : null,
  };
}

function toCard(m: CardMemory): Card {
  const card: Card = {
    due: new Date(m.due),
    stability: m.stability,
    difficulty: m.difficulty,
    elapsed_days: 0,
    scheduled_days: m.scheduledDays,
    learning_steps: m.learningSteps,
    reps: m.reps,
    lapses: m.lapses,
    state: STATE_ENUM[m.state],
  };
  if (m.lastReview !== null) card.last_review = new Date(m.lastReview);
  return card;
}

/** 新卡片的记忆状态 */
export function newMemory(now: number): CardMemory {
  return fromCard(createEmptyCard(new Date(now)));
}

/** 用一次评分更新记忆状态。 */
export function reviewMemory(
  memory: CardMemory | null,
  rating: Rating,
  now: number,
  params: FsrsParams = DEFAULT_FSRS,
): CardMemory {
  const card = toCard(memory ?? newMemory(now));
  return fromCard(scheduler(params).next(card, new Date(now), rating as Grade).card);
}

/** 当前的回忆概率（0–1）；新卡为 null。 */
export function retrievability(
  memory: CardMemory | null,
  now: number,
  params: FsrsParams = DEFAULT_FSRS,
): number | null {
  if (!memory || memory.state === 'new') return null;
  return scheduler(params).get_retrievability(toCard(memory), new Date(now), false);
}
