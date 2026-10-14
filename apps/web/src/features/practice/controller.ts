import type { LoadedPack } from '@mayochord/content';
import {
  type AdaptiveChange,
  type AdaptiveState,
  type AnyCard,
  adaptTimeLimit,
  type CardProgress,
  type ChordAttempt,
  type DrillType,
  detectMashing,
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
  SequentialSession,
  type SessionPlanner,
  type SessionSummary,
  startTrial,
  stepTrial,
  summarizeSession,
  type TrialEvent,
  type TrialState,
  trialXp,
  type VoicingMode,
  voicingMidi,
} from '@mayochord/core';
import { z } from 'zod';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Repositories } from '@/storage';
import { cardsForGroup, type PracticeGroup } from './groups';

/** 自由练习入口的配置（M2） */
export interface PracticeConfig {
  groupId: string;
  drill: DrillType;
  mode: VoicingMode;
  length: number;
}

export type SessionKind = 'practice' | 'warmup' | 'review' | 'guided' | 'independent' | 'mastery';

/**
 * 一轮练习的规格。自由练习、每日任务（热身、复习）、课程的各个阶段都用它描述。
 */
export interface SessionSpec {
  kind: SessionKind;
  cards: readonly AnyCard[];
  /** 最多出多少题 */
  length: number;
  /** phased = 新卡三阶段；mixed = 全部打乱交错；sequential = 按给定顺序每张一次 */
  order: 'phased' | 'mixed' | 'sequential';
  /** auto = 第一次见到的卡先示范；always = 每题都显示键位（引导练习）；never = 不能看提示（掌握检查） */
  hints: 'auto' | 'always' | 'never';
  /** 固定时限（掌握检查）；不设则用 85% 规则的自适应时限 */
  fixedTimeLimitMs?: number;
  /** 首次答对这么多题就结束（独立练习） */
  targetCorrect?: number;
  /** 答错的卡几题后重做 */
  retryWrong: boolean;
  /** 答错后必须照着提示弹对才进入下一题；false 时展示一下错在哪就继续（掌握检查） */
  requireCorrection: boolean;
  /** 写进练习记录的附加信息 */
  config?: Record<string, unknown>;
}

export interface TrialResultView {
  trialId: string;
  correct: boolean;
  timedOut: boolean;
  rating: Rating;
  reactionMs: number | null;
}

/** 卡片越熟练，实时反馈越少（规格 6.7）：full 显示按下的键；reduced 判定前不显示；minimal 连键盘也先收起 */
export type FeedbackLevel = 'full' | 'reduced' | 'minimal';

export interface PracticeView {
  status: 'idle' | 'loading' | 'running' | 'summary' | 'empty';
  spec: SessionSpec | null;
  sessionId: string | null;
  trial: TrialState | null;
  reason: PlanReason | null;
  feedback: FeedbackLevel;
  /** 当前是第几题（从 1 开始） */
  index: number;
  length: number;
  /** 首次答对的题数（独立练习的进度） */
  correctCount: number;
  streak: number;
  /** 当前题的成绩（第一次判定之后） */
  result: TrialResultView | null;
  timeLimitMs: number;
  adaptiveChange: AdaptiveChange;
  /** 自适应调整后的新时限（下一题起生效） */
  nextTimeLimitMs: number | null;
  summary: SessionSummary | null;
  /** 这一轮得到的 XP */
  xp: number;
  /** 有日志没能保存（例如 IndexedDB 不可用） */
  saveError: boolean;
}

const IDLE: PracticeView = {
  status: 'idle',
  spec: null,
  sessionId: null,
  trial: null,
  reason: null,
  feedback: 'full',
  index: 0,
  length: 0,
  correctCount: 0,
  streak: 0,
  result: null,
  timeLimitMs: 0,
  adaptiveChange: null,
  nextTimeLimitMs: null,
  summary: null,
  xp: 0,
  saveError: false,
};

/** 一轮结束后交给调用方的结果（课程、每日任务据此写主题日志） */
export interface SessionResult {
  spec: SessionSpec;
  sessionId: string;
  evidence: Evidence[];
  logs: ReviewLog[];
  summary: SessionSummary;
  xp: number;
  /** 是否完整做完（没有中途结束） */
  completed: boolean;
}

export interface PracticeDeps {
  pack: LoadedPack;
  groups: readonly PracticeGroup[];
  repos: () => Repositories | null;
  strategy: () => SchedulingStrategy;
  /** 订阅实时的和弦尝试（已校准、已合并） */
  onAttempt: (cb: (a: ChordAttempt) => void) => () => void;
  /** 订阅按下的音（检测乱按） */
  onNoteOn?: (cb: (note: number, t: number) => void) => () => void;
  /** 现在按住的音 */
  heldNow: () => readonly number[];
  onsetWindowMs: () => number;
  /** performance.now() 域，与输入事件同源 */
  now: () => number;
  /** 墙上时钟（写日志用；开发时可以"模拟时间前进"） */
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
/** 引导练习等"不限时"的阶段实际用的时限 */
const UNLIMITED_MS = 600_000;
/** 掌握检查答错后展示多久再进入下一题 */
const SHOW_MISTAKE_MS = 1400;

/** 自由练习的配置 → 规格 */
export function practiceSpec(
  config: PracticeConfig,
  groups: readonly PracticeGroup[],
): SessionSpec {
  const group = groups.find((g) => g.id === config.groupId);
  return {
    kind: 'practice',
    cards: group ? cardsForGroup(group, config.drill, config.mode) : [],
    length: config.length,
    order: 'phased',
    hints: 'auto',
    retryWrong: true,
    requireCorrection: true,
    config: { ...config },
  };
}

/** 卡片熟练度 → 实时反馈的多少 */
export function feedbackLevelFor(p: CardProgress | undefined): FeedbackLevel {
  if (p?.phase !== 'mixed') return 'full';
  return (p.memory?.stability ?? 0) >= 7 ? 'minimal' : 'reduced';
}

/**
 * 一轮练习的控制器：出题 → 用实时输入驱动判定（stepTrial）→ 评分 →
 * 写日志、更新卡片进度 → 85% 自适应 → 下一题，结束时生成轮次总结。
 * 判定、评分、调度都是 core 里的纯函数，这里只负责把它们和输入、存储、计时器接起来。
 */
export class PracticeController {
  readonly store: StoreApi<PracticeView> = createStore<PracticeView>()(() => IDLE);

  private planner: SessionPlanner | null = null;
  private spec: SessionSpec | null = null;
  private strategy: SchedulingStrategy | null = null;
  private progress = new Map<string, CardProgress>();
  private history: ReviewLog[] = [];
  private adaptive: Record<string, AdaptiveState> = {};
  private evidence: Evidence[] = [];
  private logs: ReviewLog[] = [];
  private startedAt = 0;
  private unsubscribe: (() => void)[] = [];
  private tickTimer: unknown = null;
  private nextTimer: unknown = null;
  private pending: Promise<unknown>[] = [];
  private generation = 0;
  /** 已评分但还没写入的日志（一题完成时补上 XP 再写） */
  private pendingLog: ReviewLog | null = null;
  private noteOns: { note: number; t: number }[] = [];
  private finishCallbacks: ((r: SessionResult) => void)[] = [];
  private readonly timers: Timers;

  constructor(private readonly deps: PracticeDeps) {
    this.timers = deps.timers ?? GLOBAL_TIMERS;
  }

  get view(): PracticeView {
    return this.store.getState();
  }

  private set(patch: Partial<PracticeView>) {
    this.store.setState(patch);
  }

  /** 自由练习（M2 的入口） */
  startPractice(config: PracticeConfig): Promise<void> {
    return this.start(practiceSpec(config, this.deps.groups));
  }

  /** 一轮结束（做完或中途结束）时回调一次 */
  onFinish(cb: (r: SessionResult) => void): () => void {
    this.finishCallbacks.push(cb);
    return () => {
      this.finishCallbacks = this.finishCallbacks.filter((x) => x !== cb);
    };
  }

  async start(spec: SessionSpec): Promise<void> {
    this.dispose();
    const gen = ++this.generation;
    this.set({ ...IDLE, status: 'loading', spec });
    if (spec.cards.length === 0) {
      this.set({ status: 'empty' });
      return;
    }

    const strategy = this.deps.strategy();
    const repos = this.safeRepos();
    let progress = new Map<string, CardProgress>();
    let history: ReviewLog[] = [];
    let adaptiveRaw: unknown;
    let saveError = repos === null;
    try {
      if (repos) {
        [progress, history, adaptiveRaw] = await Promise.all([
          repos.cardStates.getMany(spec.cards.map((c) => c.id)),
          repos.reviewLogs.latest(HISTORY),
          repos.settings.get(ADAPTIVE_KEY),
        ]);
      }
    } catch {
      saveError = true;
    }
    if (gen !== this.generation) return;

    const parsed = AdaptiveSchema.safeParse(adaptiveRaw);
    this.adaptive = parsed.success ? parsed.data : {};
    this.strategy = strategy;
    this.spec = spec;
    this.progress = progress;
    this.history = history;
    this.evidence = [];
    this.logs = [];
    this.startedAt = this.deps.wallNow();

    if (spec.order === 'sequential') {
      this.planner = new SequentialSession(spec.cards.slice(0, spec.length));
    } else {
      const phases =
        spec.order === 'mixed'
          ? new Map(
              spec.cards.map((c) => [
                c.id,
                { ...(progress.get(c.id) ?? emptyProgress(c.id)), phase: 'mixed' as const },
              ]),
            )
          : progress;
      this.planner = new PracticeSession(spec.cards, phases, {
        ...strategy.session,
        length: spec.length,
        retryWrong: spec.retryWrong,
      });
    }

    const sessionId = this.deps.uuid();
    this.set({
      status: 'running',
      sessionId,
      length: spec.order === 'sequential' ? Math.min(spec.length, spec.cards.length) : spec.length,
      saveError,
    });
    this.persistSession(null, null);
    this.unsubscribe = [
      this.deps.onAttempt((attempt) => this.dispatch({ type: 'attempt', attempt })),
      ...(this.deps.onNoteOn
        ? [this.deps.onNoteOn((note, t) => this.noteOns.push({ note, t }))]
        : []),
    ];
    this.nextTrial();
  }

  /** 显示键位提示（会记为用过提示）；掌握检查里不可用 */
  hint() {
    if (this.spec?.hints === 'never') return;
    this.dispatch({ type: 'hint', now: this.deps.now() });
  }

  /** 跳过这一题（没弹出来的记为超时） */
  skip() {
    this.dispatch({ type: 'skip', now: this.deps.now() });
  }

  /** 结束这一轮（中途结束时只总结已完成的部分） */
  finish() {
    this.end(false);
  }

  private end(completed: boolean) {
    if (this.view.status !== 'running') return;
    this.clearTimers();
    for (const u of this.unsubscribe) u();
    this.unsubscribe = [];
    this.flushPendingLog(this.deps.now());
    const summary = summarizeSession(this.evidence);
    const { sessionId } = this.view;
    const xp = this.view.xp;
    this.set({ status: 'summary', summary, trial: null });
    this.persistSession(summary, this.deps.wallNow());
    if (sessionId && this.spec) {
      const result: SessionResult = {
        spec: this.spec,
        sessionId,
        evidence: [...this.evidence],
        logs: [...this.logs],
        summary,
        xp,
        completed,
      };
      for (const cb of [...this.finishCallbacks]) cb(result);
    }
  }

  /** 等待所有写入完成（测试用） */
  async flush(): Promise<void> {
    await Promise.allSettled(this.pending);
  }

  /** 停止当前这一轮并清掉所有回调（离开页面、开始新的一轮时） */
  dispose() {
    this.generation++;
    this.finishCallbacks = [];
    this.clearTimers();
    for (const u of this.unsubscribe) u();
    this.unsubscribe = [];
    this.planner = null;
    this.pendingLog = null;
    this.set(IDLE);
  }

  private clearTimers() {
    if (this.tickTimer) this.timers.clear(this.tickTimer);
    if (this.nextTimer) this.timers.clear(this.nextTimer);
    this.tickTimer = null;
    this.nextTimer = null;
  }

  private safeRepos(): Repositories | null {
    try {
      return this.deps.repos();
    } catch {
      return null;
    }
  }

  private timeLimitFor(drill: DrillType): number {
    const spec = this.spec as SessionSpec;
    if (spec.fixedTimeLimitMs !== undefined) return spec.fixedTimeLimitMs;
    if (spec.hints === 'always') return UNLIMITED_MS;
    const state =
      this.adaptive[drill] ??
      initialAdaptiveState(this.strategy?.adaptive[drill].initialMs ?? 6000);
    return state.timeLimitMs;
  }

  private nextTrial() {
    const planner = this.planner;
    const strategy = this.strategy;
    const spec = this.spec;
    if (!planner || !strategy || !spec) return;
    if (spec.targetCorrect !== undefined && this.view.correctCount >= spec.targetCorrect) {
      this.end(true);
      return;
    }
    const item = planner.next();
    if (!item) {
      this.end(true);
      return;
    }
    const drill = drillForCard(item.card);
    const progress = this.progress.get(item.card.id);
    const timeLimitMs = this.timeLimitFor(drill.type);
    const hintAtStart =
      spec.hints === 'always' ||
      (spec.hints === 'auto' && strategy.hintAtStart(progress ?? emptyProgress(item.card.id)));
    const trial = drill.createTrial(item.card, {
      referenceNotes: (id) => this.referenceNotes(id),
      hasBass: (id) => this.deps.pack.chordById.get(id)?.bassName !== undefined,
      timeLimitMs,
      onsetWindowMs: this.deps.onsetWindowMs(),
      hintAtStart,
      trialId: this.deps.uuid(),
    });
    const state = startTrial(trial, this.deps.now(), this.deps.heldNow());
    this.noteOns = [];
    this.set({
      trial: state,
      reason: item.reason,
      feedback: spec.hints === 'always' ? 'full' : feedbackLevelFor(progress),
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
    if (next.status === 'done') {
      this.complete(next);
      return;
    }
    // 不要求改正（掌握检查）：答错后展示一下就进入下一题
    if (next.status === 'retry' && this.spec && !this.spec.requireCorrection) {
      if (this.tickTimer) this.timers.clear(this.tickTimer);
      this.tickTimer = this.timers.set(() => {
        this.tickTimer = null;
        this.dispatch({ type: 'skip', now: this.deps.now() });
      }, SHOW_MISTAKE_MS);
      return;
    }
    this.scheduleTick(next);
  }

  /** 第一次判定：评分、更新卡片进度和自适应时限（日志在这一题完成时写入） */
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

    let adaptiveChange: AdaptiveChange = null;
    let nextTimeLimitMs: number | null = null;
    if (this.spec?.fixedTimeLimitMs === undefined && this.spec?.hints !== 'always') {
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
      adaptiveChange = adapted.change;
      nextTimeLimitMs = adapted.change ? adapted.state.timeLimitMs : null;
      const adaptive = this.adaptive;
      this.persist((r) => r.settings.set(ADAPTIVE_KEY, adaptive));
    }

    const result: TrialResultView = {
      trialId: state.trial.id,
      correct: ev.correct,
      timedOut: ev.timedOut,
      rating,
      reactionMs: log.reactionMs,
    };
    this.pendingLog = log;
    this.set({
      result,
      streak: ev.correct ? this.view.streak + 1 : 0,
      correctCount: this.view.correctCount + (ev.correct ? 1 : 0),
      adaptiveChange,
      nextTimeLimitMs,
    });
    this.deps.onResult?.(result);
    const cardProgress = progress;
    this.persist((r) => r.cardStates.put(cardProgress));
  }

  /** 写入已评分的日志：补上这一题的 XP 与乱按标记 */
  private flushPendingLog(now: number) {
    const log = this.pendingLog;
    const trial = this.view.trial;
    if (!log || !trial) return;
    this.pendingLog = null;
    const mashing = detectMashing(this.noteOns, trial.trial.target);
    const xp = Math.round(trialXp(now - trial.startT, mashing) * 1000) / 1000;
    const full: ReviewLog = { ...log, xp, mashing };
    this.logs.push(full);
    this.set({ xp: this.view.xp + xp });
    this.persist((r) => r.reviewLogs.append(full));
  }

  private complete(state: TrialState) {
    if (this.tickTimer) this.timers.clear(this.tickTimer);
    this.tickTimer = null;
    this.flushPendingLog(state.doneAt ?? this.deps.now());
    const outcome = state.outcome;
    if (outcome && this.planner) {
      const cardId = state.trial.card.id;
      this.planner.record(
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

  private persistSession(summary: SessionSummary | null, endedAt: number | null) {
    const { sessionId } = this.view;
    const spec = this.spec;
    if (!sessionId || !spec) return;
    const record = {
      id: sessionId,
      startedAt: this.startedAt,
      endedAt,
      kind: 'practice' as const,
      config: { kind: spec.kind, ...spec.config },
      summary,
      xp: Math.round(this.view.xp * 1000) / 1000,
    };
    this.persist((r) => r.sessions.put(record));
  }

  private persist(write: (r: Repositories) => Promise<unknown>) {
    const repos = this.safeRepos();
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
