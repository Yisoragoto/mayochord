import type { LoadedPack } from '@mayochord/content';
import {
  type AdaptiveChange,
  type AdaptiveState,
  type AnyCard,
  adaptTimeLimit,
  type CardProgress,
  type ChordAttempt,
  type DrillType,
  drillForCard,
  type Evidence,
  emptyProgress,
  initialAdaptiveState,
  msUntilTimeout,
  type PlanReason,
  PracticeSession,
  personalMedian,
  type Rating,
  type ReviewLog,
  type SchedulingStrategy,
  type SessionSummary,
  startTrial,
  stepTrial,
  summarizeSession,
  type TrialEvent,
  type TrialState,
  type VoicingMode,
  voicingMidi,
} from '@mayochord/core';
import { z } from 'zod';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Repositories } from '@/storage';
import { cardsForGroup, type PracticeGroup } from './groups';

export interface PracticeConfig {
  groupId: string;
  drill: DrillType;
  mode: VoicingMode;
  length: number;
}

export interface TrialResultView {
  trialId: string;
  correct: boolean;
  timedOut: boolean;
  rating: Rating;
  reactionMs: number | null;
}

export interface PracticeView {
  status: 'idle' | 'loading' | 'running' | 'summary' | 'empty';
  config: PracticeConfig | null;
  sessionId: string | null;
  trial: TrialState | null;
  reason: PlanReason | null;
  /** 当前是第几题（从 1 开始） */
  index: number;
  length: number;
  streak: number;
  /** 当前题的成绩（第一次判定之后） */
  result: TrialResultView | null;
  timeLimitMs: number;
  adaptiveChange: AdaptiveChange;
  /** 自适应调整后的新时限（下一题起生效） */
  nextTimeLimitMs: number | null;
  summary: SessionSummary | null;
  /** 有日志没能保存（例如 IndexedDB 不可用） */
  saveError: boolean;
}

const IDLE: PracticeView = {
  status: 'idle',
  config: null,
  sessionId: null,
  trial: null,
  reason: null,
  index: 0,
  length: 0,
  streak: 0,
  result: null,
  timeLimitMs: 0,
  adaptiveChange: null,
  nextTimeLimitMs: null,
  summary: null,
  saveError: false,
};

export interface PracticeDeps {
  pack: LoadedPack;
  groups: readonly PracticeGroup[];
  repos: () => Repositories | null;
  strategy: () => SchedulingStrategy;
  /** 订阅实时的和弦尝试（已校准、已合并） */
  onAttempt: (cb: (a: ChordAttempt) => void) => () => void;
  /** 现在按住的音 */
  heldNow: () => readonly number[];
  onsetWindowMs: () => number;
  /** performance.now() 域，与输入事件同源 */
  now: () => number;
  /** 墙上时钟（写日志用） */
  wallNow: () => number;
  uuid: () => string;
  /** 一题结束后等多久再出下一题（毫秒） */
  nextDelayMs: (firstTryCorrect: boolean) => number;
  /** 一题结束（例如在点击切换模式下松开屏幕键盘的音） */
  onTrialDone?: (trial: TrialState) => void;
  /** 有了成绩（第一次判定）：音效等反馈 */
  onResult?: (r: TrialResultView) => void;
  /** 计时器（测试里替换成手动推进的版本） */
  timers?: Timers;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const GLOBAL_TIMERS: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const ADAPTIVE_KEY = 'adaptive';
const AdaptiveSchema = z.record(
  z.string(),
  z.object({ timeLimitMs: z.number().positive(), sinceAdjust: z.number().int().min(0) }),
);

/** 最近多少条日志用于个人中位数和 85% 规则 */
const HISTORY = 500;

/**
 * 一轮练习的控制器：出题（PracticeSession）→ 用实时输入驱动判定（stepTrial）→ 评分 →
 * 写日志、更新卡片进度 → 85% 自适应 → 下一题，结束时生成轮次总结。
 * 判定、评分、调度都是 core 里的纯函数，这里只负责把它们和输入、存储、计时器接起来。
 */
export class PracticeController {
  readonly store: StoreApi<PracticeView> = createStore<PracticeView>()(() => IDLE);

  private session: PracticeSession | null = null;
  private strategy: SchedulingStrategy | null = null;
  private progress = new Map<string, CardProgress>();
  private history: ReviewLog[] = [];
  private adaptive: Record<string, AdaptiveState> = {};
  private evidence: Evidence[] = [];
  private startedAt = 0;
  private unsubscribe: (() => void) | null = null;
  private tickTimer: unknown = null;
  private nextTimer: unknown = null;
  private readonly timers: Timers;
  private pending: Promise<unknown>[] = [];
  private generation = 0;

  constructor(private readonly deps: PracticeDeps) {
    this.timers = deps.timers ?? GLOBAL_TIMERS;
  }

  get view(): PracticeView {
    return this.store.getState();
  }

  private set(patch: Partial<PracticeView>) {
    this.store.setState(patch);
  }

  async start(config: PracticeConfig): Promise<void> {
    this.dispose();
    const gen = ++this.generation;
    const group = this.deps.groups.find((g) => g.id === config.groupId);
    const cards = group ? cardsForGroup(group, config.drill, config.mode) : [];
    this.set({ ...IDLE, status: 'loading', config });
    if (cards.length === 0) {
      this.set({ status: 'empty' });
      return;
    }

    const strategy = this.deps.strategy();
    const repos = this.deps.repos();
    let progress = new Map<string, CardProgress>();
    let history: ReviewLog[] = [];
    let adaptiveRaw: unknown;
    try {
      if (repos) {
        [progress, history, adaptiveRaw] = await Promise.all([
          repos.cardStates.getMany(cards.map((c) => c.id)),
          repos.reviewLogs.latest(HISTORY),
          repos.settings.get(ADAPTIVE_KEY),
        ]);
      }
    } catch {
      this.set({ saveError: true });
    }
    if (gen !== this.generation) return;

    const parsed = AdaptiveSchema.safeParse(adaptiveRaw);
    this.adaptive = parsed.success ? parsed.data : {};
    this.strategy = strategy;
    this.progress = progress;
    this.history = history;
    this.evidence = [];
    this.startedAt = this.deps.wallNow();
    this.session = new PracticeSession(cards, progress, {
      ...strategy.session,
      length: config.length,
    });
    const sessionId = this.deps.uuid();
    this.set({ status: 'running', sessionId, length: config.length });
    this.persist((r) =>
      r.sessions.put({
        id: sessionId,
        startedAt: this.startedAt,
        endedAt: null,
        kind: 'practice',
        config: { ...config },
        summary: null,
      }),
    );
    this.unsubscribe = this.deps.onAttempt((attempt) =>
      this.dispatch({ type: 'attempt', attempt }),
    );
    this.nextTrial();
  }

  /** 显示键位提示（会记为用过提示） */
  hint() {
    this.dispatch({ type: 'hint', now: this.deps.now() });
  }

  /** 跳过这一题（没弹出来的记为超时） */
  skip() {
    this.dispatch({ type: 'skip', now: this.deps.now() });
  }

  /** 提前结束这一轮，显示已完成部分的总结 */
  finish() {
    if (this.view.status !== 'running') return;
    this.clearTimers();
    this.unsubscribe?.();
    this.unsubscribe = null;
    const summary = summarizeSession(this.evidence);
    const { sessionId, config } = this.view;
    this.set({ status: 'summary', summary, trial: null });
    if (sessionId && config) {
      this.persist((r) =>
        r.sessions.put({
          id: sessionId,
          startedAt: this.startedAt,
          endedAt: this.deps.wallNow(),
          kind: 'practice',
          config: { ...config },
          summary,
        }),
      );
    }
  }

  /** 等待所有写入完成（测试用） */
  async flush(): Promise<void> {
    await Promise.allSettled(this.pending);
  }

  dispose() {
    this.generation++;
    this.clearTimers();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session = null;
    this.set(IDLE);
  }

  private clearTimers() {
    if (this.tickTimer) this.timers.clear(this.tickTimer);
    if (this.nextTimer) this.timers.clear(this.nextTimer);
    this.tickTimer = null;
    this.nextTimer = null;
  }

  private timeLimitFor(drill: DrillType): number {
    const state =
      this.adaptive[drill] ??
      initialAdaptiveState(this.strategy?.adaptive[drill].initialMs ?? 6000);
    return state.timeLimitMs;
  }

  private nextTrial() {
    const session = this.session;
    const strategy = this.strategy;
    if (!session || !strategy) return;
    const item = session.next();
    if (!item) {
      this.finish();
      return;
    }
    const drill = drillForCard(item.card);
    const progress = this.progress.get(item.card.id) ?? emptyProgress(item.card.id);
    const timeLimitMs = this.timeLimitFor(drill.type);
    const trial = drill.createTrial(item.card, {
      referenceNotes: (id) => this.referenceNotes(id),
      timeLimitMs,
      onsetWindowMs: this.deps.onsetWindowMs(),
      hintAtStart: strategy.hintAtStart(progress),
      trialId: this.deps.uuid(),
    });
    const state = startTrial(trial, this.deps.now(), this.deps.heldNow());
    this.set({
      trial: state,
      reason: item.reason,
      index: this.view.index + 1,
      result: null,
      timeLimitMs,
      adaptiveChange: null,
      nextTimeLimitMs: null,
    });
    this.scheduleTick(state);
  }

  private referenceNotes(chordId: string): number[] {
    const chord = this.deps.pack.chordById.get(chordId);
    if (!chord) throw new Error(`Unknown chord ${chordId}`);
    return voicingMidi(chord.reference);
  }

  private scheduleTick(state: TrialState) {
    if (this.tickTimer) this.timers.clear(this.tickTimer);
    this.tickTimer = null;
    const wait = msUntilTimeout(state, this.deps.now());
    if (wait === null) return;
    this.tickTimer = this.timers.set(() => {
      this.tickTimer = null;
      this.dispatch({ type: 'tick', now: this.deps.now() });
    }, wait + 5);
  }

  private dispatch(event: TrialEvent) {
    const prev = this.view.trial;
    if (this.view.status !== 'running' || !prev || prev.status === 'done') return;
    const next = stepTrial(prev, event);
    if (next === prev) return;
    this.set({ trial: next });
    if (!prev.outcome && next.outcome) this.grade(next);
    if (next.status === 'done') this.complete(next);
    else this.scheduleTick(next);
  }

  /** 第一次判定：评分、写日志、更新卡片进度和自适应时限 */
  private grade(state: TrialState) {
    const strategy = this.strategy as SchedulingStrategy;
    const outcome = state.outcome as NonNullable<TrialState['outcome']>;
    const drill = drillForCard(state.trial.card);
    const [ev] = drill.toEvidence(state.trial, outcome);
    if (!ev) return;
    const median = personalMedian(
      this.history,
      { drillType: ev.drillType, inputSource: ev.inputSource },
      strategy.grading,
    );
    const rating = strategy.grade(ev, median);
    const log: ReviewLog = {
      id: this.deps.uuid(),
      ts: this.deps.wallNow(),
      sessionId: this.view.sessionId,
      cardId: ev.cardId,
      cardKind: ev.cardKind,
      drillType: ev.drillType,
      evidence: 'explicit',
      weight: 1,
      correct: ev.correct,
      reactionMs: ev.reactionMs === null ? null : Math.round(ev.reactionMs),
      extraNotes: ev.extraNotes,
      missingNotes: ev.missingNotes,
      spreadMs: ev.spreadMs === null ? null : Math.round(ev.spreadMs),
      beatOffsetMs: null,
      hintUsed: ev.hintUsed,
      rating,
      inputSource: ev.inputSource,
      contentVersion: this.deps.pack.version,
    };
    this.evidence.push(ev);
    this.history.push(log);
    const progress = strategy.applyLog(
      this.progress.get(ev.cardId) ?? emptyProgress(ev.cardId),
      log,
    );
    this.progress.set(ev.cardId, progress);

    const params = strategy.adaptive[ev.drillType].params;
    const recent = this.history
      .filter((l) => l.drillType === ev.drillType && l.evidence === 'explicit')
      .map((l) => l.correct);
    const adapted = adaptTimeLimit(
      this.adaptive[ev.drillType] ??
        initialAdaptiveState(strategy.adaptive[ev.drillType].initialMs),
      recent,
      params,
    );
    this.adaptive = { ...this.adaptive, [ev.drillType]: adapted.state };

    const result: TrialResultView = {
      trialId: state.trial.id,
      correct: ev.correct,
      timedOut: ev.timedOut,
      rating,
      reactionMs: log.reactionMs,
    };
    this.set({
      result,
      streak: ev.correct ? this.view.streak + 1 : 0,
      adaptiveChange: adapted.change,
      nextTimeLimitMs: adapted.change ? adapted.state.timeLimitMs : null,
    });
    this.deps.onResult?.(result);

    const adaptive = this.adaptive;
    this.persist(async (r) => {
      await r.reviewLogs.append(log);
      await r.cardStates.put(progress);
      await r.settings.set(ADAPTIVE_KEY, adaptive);
    });
  }

  private complete(state: TrialState) {
    if (this.tickTimer) this.timers.clear(this.tickTimer);
    this.tickTimer = null;
    const outcome = state.outcome;
    if (outcome && this.session) {
      const cardId = state.trial.card.id;
      this.session.record(
        cardId,
        this.progress.get(cardId) ?? emptyProgress(cardId),
        outcome.correct,
      );
    }
    this.deps.onTrialDone?.(state);
    const delay = this.deps.nextDelayMs(outcome?.correct === true);
    this.nextTimer = this.timers.set(() => {
      this.nextTimer = null;
      this.nextTrial();
    }, delay);
  }

  private persist(write: (r: Repositories) => Promise<unknown>) {
    let repos: Repositories | null = null;
    try {
      repos = this.deps.repos();
    } catch {
      repos = null;
    }
    if (!repos) {
      this.set({ saveError: true });
      return;
    }
    const p = write(repos).catch(() => this.set({ saveError: true }));
    this.pending.push(p);
    void p.finally(() => {
      this.pending = this.pending.filter((x) => x !== p);
    });
  }
}

/** 一组卡片里每个阶段各有多少张（练习入口显示用） */
export function phaseCounts(
  cards: readonly AnyCard[],
  progress: ReadonlyMap<string, CardProgress>,
  now: number,
) {
  let fresh = 0;
  let learning = 0;
  let mixed = 0;
  let due = 0;
  for (const c of cards) {
    const p = progress.get(c.id);
    if (!p || p.attempts === 0) fresh++;
    else if (p.phase === 'mixed') mixed++;
    else learning++;
    if (p?.memory && p.memory.state !== 'new' && p.memory.due <= now) due++;
  }
  return { total: cards.length, fresh, learning, mixed, due };
}
