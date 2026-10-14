import type { AnyCard } from '../drill/cards';
import type { CardPhase, CardProgress } from './progress';

/**
 * 一次练习之内的出题顺序（规格 6.4）：
 * - 新卡（focused 阶段）集中练：同一张卡连续出现，直到进入 ordered 阶段或达到 maxFocusReps；
 * - ordered 阶段的卡按和弦组/进行的原有顺序出现；mixed 阶段的卡打乱顺序；
 * - 每做完一个集中练块，先把已有的卡轮一遍，再开始下一张新卡（巩固 + 交错）；
 * - 答错的卡在 reinsertMin–reinsertMax 题之后再出现；
 * - 集中练之外，相邻两题尽量不是同一张卡。
 */
export interface SessionParams {
  /** 本轮题数 */
  length: number;
  reinsertMin: number;
  reinsertMax: number;
  /** 一张新卡在一轮里集中练的最多次数（练不会也先放一放） */
  maxFocusReps: number;
  /** 答错的卡是否在几题后重做（掌握检查、测验里不重做） */
  retryWrong: boolean;
}

export const DEFAULT_SESSION: SessionParams = {
  length: 20,
  reinsertMin: 3,
  reinsertMax: 5,
  maxFocusReps: 6,
  retryWrong: true,
};

export type PlanReason = 'focus' | 'ordered' | 'mixed' | 'retry';

export interface PlannedItem {
  card: AnyCard;
  reason: PlanReason;
}

export type Rng = () => number;

/** 可复现的伪随机数（测试用） */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(xs: readonly T[], rng: Rng): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** 出题器接口：练习会话、课程的引导练习等都实现它 */
export interface SessionPlanner {
  readonly length: number;
  readonly completed: number;
  next(): PlannedItem | null;
  record(cardId: string, progress: CardProgress, correct: boolean): void;
}

/** 按给定顺序每张卡出一次（课程的引导练习） */
export class SequentialSession implements SessionPlanner {
  private i = 0;
  private done = 0;
  constructor(private readonly cards: readonly AnyCard[]) {}
  get length() {
    return this.cards.length;
  }
  get completed() {
    return this.done;
  }
  next(): PlannedItem | null {
    const card = this.cards[this.i++];
    return card ? { card, reason: 'ordered' } : null;
  }
  record() {
    this.done++;
  }
}

export class PracticeSession implements SessionPlanner {
  private readonly cards: readonly AnyCard[];
  private readonly byId: Map<string, AnyCard>;
  private readonly phases = new Map<string, CardPhase>();
  private readonly params: SessionParams;
  private readonly rng: Rng;

  private served = 0;
  private recorded = 0;
  private focusCard: string | null = null;
  private focusReps = 0;
  private readonly focusDone = new Set<string>();
  private rotation: string[] = [];
  private roundSinceFocus = false;
  private retries: { cardId: string; at: number }[] = [];
  private last: string | null = null;

  constructor(
    cards: readonly AnyCard[],
    progress: ReadonlyMap<string, CardProgress>,
    params: Partial<SessionParams> = {},
    rng: Rng = Math.random,
  ) {
    this.cards = cards;
    this.byId = new Map(cards.map((c) => [c.id, c]));
    for (const c of cards) this.phases.set(c.id, progress.get(c.id)?.phase ?? 'focused');
    this.params = { ...DEFAULT_SESSION, ...params };
    this.rng = rng;
  }

  get length(): number {
    return this.params.length;
  }

  /** 已经记录成绩的题数 */
  get completed(): number {
    return this.recorded;
  }

  phaseOf(cardId: string): CardPhase {
    return this.phases.get(cardId) ?? 'focused';
  }

  /** 下一题；本轮题数已满时为 null。 */
  next(): PlannedItem | null {
    if (this.served >= this.params.length || this.cards.length === 0) return null;
    const item = this.pick();
    this.served++;
    this.last = item.card.id;
    return item;
  }

  private item(cardId: string, reason: PlanReason): PlannedItem {
    return { card: this.byId.get(cardId) as AnyCard, reason };
  }

  private pick(): PlannedItem {
    // 1. 到期的重做题
    const idx = this.retries.findIndex((r) => r.at <= this.served && r.cardId !== this.last);
    if (idx >= 0) {
      const [r] = this.retries.splice(idx, 1);
      return this.item((r as { cardId: string }).cardId, 'retry');
    }
    // 2. 正在集中练的卡
    if (this.focusCard) return this.item(this.focusCard, 'focus');
    // 3. 这一轮还没出完的卡
    const fromRotation = this.popRotation();
    if (fromRotation) return fromRotation;
    // 4. 下一张新卡（如果已有的卡刚轮过一遍，或者还没有可轮的卡）
    const pool = this.pool();
    const nextNew = this.cards.find(
      (c) => this.phaseOf(c.id) === 'focused' && !this.focusDone.has(c.id),
    );
    if (nextNew && (this.roundSinceFocus || pool.length === 0)) {
      this.focusCard = nextNew.id;
      this.focusReps = 0;
      return this.item(nextNew.id, 'focus');
    }
    // 5. 新的一轮
    this.buildRound(pool);
    return this.popRotation() ?? this.item((this.cards[0] as AnyCard).id, 'mixed');
  }

  /** 可以轮流出现的卡：ordered、mixed，以及本轮集中练已到上限的新卡 */
  private pool(): AnyCard[] {
    return this.cards.filter(
      (c) =>
        (this.phaseOf(c.id) !== 'focused' || this.focusDone.has(c.id)) && !this.pendingRetry(c.id),
    );
  }

  /** 等待重做的卡不从轮换里出，保证它与上次出现之间隔着 3–5 题 */
  private pendingRetry(cardId: string): boolean {
    return this.retries.some((r) => r.cardId === cardId);
  }

  private buildRound(pool: readonly AnyCard[]) {
    const ordered = pool.filter((c) => this.phaseOf(c.id) !== 'mixed').map((c) => c.id);
    const mixed = shuffle(
      pool.filter((c) => this.phaseOf(c.id) === 'mixed').map((c) => c.id),
      this.rng,
    );
    this.rotation = this.rng() < 0.5 ? [...ordered, ...mixed] : [...mixed, ...ordered];
    // 新一轮的第一题不要和上一题相同
    if (this.rotation.length > 1 && this.rotation[0] === this.last) {
      const first = this.rotation.shift() as string;
      this.rotation.splice(1, 0, first);
    }
    this.roundSinceFocus = true;
  }

  private popRotation(): PlannedItem | null {
    while (this.rotation.length > 0) {
      let i = 0;
      if (this.rotation[0] === this.last && this.rotation.length > 1) i = 1;
      const [id] = this.rotation.splice(i, 1);
      if (id === undefined || this.pendingRetry(id)) continue;
      const reason = this.phaseOf(id) === 'mixed' ? 'mixed' : 'ordered';
      return this.item(id, reason);
    }
    return null;
  }

  /** 记录一题的结果。progress 是用这次日志更新后的卡片进度。 */
  record(cardId: string, progress: CardProgress, correct: boolean) {
    this.recorded++;
    this.phases.set(cardId, progress.phase);

    if (cardId === this.focusCard) {
      this.focusReps++;
      if (progress.phase !== 'focused') {
        this.focusCard = null;
        this.roundSinceFocus = false;
      } else if (this.focusReps >= this.params.maxFocusReps) {
        this.focusDone.add(cardId);
        this.focusCard = null;
        this.roundSinceFocus = false;
      }
      return;
    }

    if (this.params.retryWrong && !correct && !this.retries.some((r) => r.cardId === cardId)) {
      const { reinsertMin: lo, reinsertMax: hi } = this.params;
      const gap = lo + Math.floor(this.rng() * (hi - lo + 1));
      this.retries.push({ cardId, at: this.served + gap });
    }
  }
}
