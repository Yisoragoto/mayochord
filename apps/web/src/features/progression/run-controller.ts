import type { LoadedPack } from '@mayochord/content';
import {
  adaptBpm,
  type BeatGrid,
  type CardProgress,
  type ChordAttempt,
  emptyProgress,
  gradeRunEvidence,
  type InputSourceKind,
  type ReviewLog,
  type RunSpec,
  type RunState,
  type RunSummary,
  runAttempt,
  runCardIds,
  runTick,
  type SchedulingStrategy,
  type StepResult,
  scheduleStep,
  sourceKind,
  startRun,
  stepClean,
  stepEvidence,
  stopRun,
  summarizeRun,
  trialXp,
} from '@mayochord/core';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Repositories } from '@/storage';
import type { Timers } from '../practice/controller';
import type { RunSource } from './run-source';

/** 节拍器（测试里换成假的） */
export interface MetronomeLike {
  grid: BeatGrid;
  stop(): void;
}

export type RunKind = 'practice' | 'guided' | 'independent' | 'mastery';

export interface RunConfig {
  kind: RunKind;
  source: RunSource;
  spec: RunSpec;
  /** 节拍器怎么响 */
  click: { mode: 'all' | 'backbeat' | 'off'; accent: boolean };
  /** 结束后按 85% 规则给出下一次的 BPM */
  adaptiveBpm: boolean;
  /** 干净地弹对这么多个和弦就结束（课程的独立练习；配合 loops = null） */
  targetClean?: number;
  /** 写进练习记录的附加信息 */
  config?: Record<string, unknown>;
}

export interface RunView {
  status: 'idle' | 'starting' | 'running' | 'summary' | 'error';
  config: RunConfig | null;
  grid: BeatGrid | null;
  results: StepResult[];
  /** 下一个还没有成绩的步 */
  open: number;
  /** 当前步只按了一部分（等补全） */
  partial: number[] | null;
  summary: RunSummary | null;
  xp: number;
  /** 85% 规则给出的下一次 BPM */
  nextBpm: { bpm: number; change: 'faster' | 'slower' | null } | null;
  saveError: boolean;
}

const IDLE: RunView = {
  status: 'idle',
  config: null,
  grid: null,
  results: [],
  open: 0,
  partial: null,
  summary: null,
  xp: 0,
  nextBpm: null,
  saveError: false,
};

export interface RunResult {
  config: RunConfig;
  sessionId: string;
  results: StepResult[];
  logs: ReviewLog[];
  summary: RunSummary;
  xp: number;
  /** 弹完了全部循环（没有中途结束） */
  completed: boolean;
}

export interface RunDeps {
  pack: LoadedPack;
  repos: () => Repositories | null;
  strategy: () => SchedulingStrategy;
  onAttempt: (cb: (a: ChordAttempt) => void) => () => void;
  startMetronome: (config: RunConfig) => Promise<MetronomeLike>;
  /** performance.now() 域 */
  now: () => number;
  wallNow: () => number;
  uuid: () => string;
  timers?: Timers;
  /** 每一步有了成绩（音效等） */
  onStep?: (r: StepResult) => void;
}

const GLOBAL_TIMERS: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** 多久检查一次窗口是否关闭（只用于定下"漏弹"，判定本身用输入事件的时间戳） */
const TICK_MS = 40;

/**
 * 跟拍弹进行的控制器：启动节拍器 → 实时和弦尝试喂给 runAttempt → 定期 runTick →
 * 每一步有成绩就写和弦卡、切换卡的显式证据（规格 6.3）→ 结束时总结、按 85% 规则给出下次的 BPM。
 */
export class ProgressionRunController {
  readonly store: StoreApi<RunView> = createStore<RunView>()(() => IDLE);
  private state: RunState | null = null;
  private metronome: MetronomeLike | null = null;
  private unsubscribe: (() => void) | null = null;
  private timer: unknown = null;
  private generation = 0;
  private strategy: SchedulingStrategy | null = null;
  private progress = new Map<string, CardProgress>();
  private logs: ReviewLog[] = [];
  private sessionId: string | null = null;
  private startedAt = 0;
  private pending: Promise<unknown>[] = [];
  private finishCallbacks: ((r: RunResult) => void)[] = [];
  private readonly timers: Timers;

  constructor(private readonly deps: RunDeps) {
    this.timers = deps.timers ?? GLOBAL_TIMERS;
  }

  get view(): RunView {
    return this.store.getState();
  }

  private set(patch: Partial<RunView>) {
    this.store.setState(patch);
  }

  onFinish(cb: (r: RunResult) => void): () => void {
    this.finishCallbacks.push(cb);
    return () => {
      this.finishCallbacks = this.finishCallbacks.filter((x) => x !== cb);
    };
  }

  async start(config: RunConfig): Promise<void> {
    this.dispose();
    const gen = ++this.generation;
    this.set({ ...IDLE, status: 'starting', config });
    const strategy = this.deps.strategy();
    const repos = this.safeRepos();
    const cardIds = runCardIds(config.spec);
    let progress = new Map<string, CardProgress>();
    let saveError = repos === null;
    let metronome: MetronomeLike;
    try {
      if (repos) {
        try {
          progress = await repos.cardStates.getMany(cardIds);
        } catch {
          saveError = true;
        }
      }
      metronome = await this.deps.startMetronome(config);
    } catch {
      if (gen === this.generation) this.set({ status: 'error' });
      return;
    }
    if (gen !== this.generation) {
      metronome.stop();
      return;
    }
    this.strategy = strategy;
    this.progress = progress;
    this.metronome = metronome;
    this.logs = [];
    this.sessionId = this.deps.uuid();
    this.startedAt = this.deps.wallNow();
    this.state = startRun(config.spec, metronome.grid.startT);
    this.set({ status: 'running', grid: metronome.grid, saveError });
    this.persistSession(null);
    this.unsubscribe = this.deps.onAttempt((a) => this.onAttempt(a));
    this.scheduleTick();
  }

  /** 手动结束（只总结已经有成绩的步） */
  stop() {
    if (!this.state || this.view.status !== 'running') return;
    this.update(stopRun(this.state), false);
  }

  /** 离开页面：停止节拍器、丢掉回调 */
  dispose() {
    this.generation++;
    this.finishCallbacks = [];
    this.teardown();
    this.state = null;
    this.set(IDLE);
  }

  /** 等待所有写入完成（测试用） */
  async flush(): Promise<void> {
    await Promise.allSettled(this.pending);
  }

  private teardown() {
    if (this.timer) this.timers.clear(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.metronome?.stop();
    this.metronome = null;
  }

  private onAttempt(a: ChordAttempt) {
    if (!this.state) return;
    const source: InputSourceKind = sourceKind(a.sources[a.newNotes[0] as number] ?? '');
    this.update(runAttempt(this.state, a, source), true);
  }

  private scheduleTick() {
    this.timer = this.timers.set(() => {
      this.timer = null;
      if (!this.state) return;
      this.update(runTick(this.state, this.deps.now()), true);
      if (this.view.status === 'running') this.scheduleTick();
    }, TICK_MS);
  }

  private update(next: RunState, completedIfFinished: boolean) {
    const prev = this.state;
    if (!prev || next === prev) return;
    this.state = next;
    const fresh = next.results.filter((r) => !prev.results.includes(r) && r.k >= prev.open);
    for (const r of fresh) this.record(r);
    this.set({
      results: next.results,
      open: next.open,
      partial: next.partial ? next.partial.attempt.notes : null,
    });
    for (const r of fresh) this.deps.onStep?.(r);
    const target = this.view.config?.targetClean;
    if (next.finished) this.end(completedIfFinished);
    else if (target !== undefined && next.results.filter(stepClean).length >= target) {
      this.state = stopRun(next);
      this.end(true);
    }
  }

  /** 一步有了成绩：和弦卡、切换卡各写一条显式证据，更新卡片进度 */
  private record(r: StepResult) {
    const config = this.view.config;
    const strategy = this.strategy;
    if (!config || !strategy || !this.state) return;
    const step = scheduleStep(config.spec, this.state.grid, r.k);
    const stepMs = scheduleStep(config.spec, this.state.grid, r.k + 1).t - step.t;
    const xp = Math.round(trialXp(stepMs, false) * 1000) / 1000;
    const ts = this.deps.wallNow();
    stepEvidence(config.spec, r).forEach((ev, i) => {
      const log: ReviewLog = {
        id: this.deps.uuid(),
        ts,
        sessionId: this.sessionId,
        cardId: ev.cardId,
        cardKind: ev.cardKind,
        drillType: 'progression',
        evidence: 'explicit',
        weight: 1,
        correct: ev.correct,
        reactionMs: null,
        extraNotes: ev.extraNotes,
        missingNotes: ev.missingNotes,
        spreadMs: ev.spreadMs,
        beatOffsetMs: ev.beatOffsetMs,
        hintUsed: ev.hintUsed,
        rating: gradeRunEvidence(ev),
        inputSource: ev.inputSource,
        contentVersion: this.deps.pack.version,
        // XP 只记在和弦卡那一条上，避免一步算两次
        xp: i === 0 ? xp : 0,
        mashing: false,
      };
      this.logs.push(log);
      const progress = strategy.applyLog(
        this.progress.get(ev.cardId) ?? emptyProgress(ev.cardId),
        log,
      );
      this.progress.set(ev.cardId, progress);
      this.persist((repo) => repo.reviewLogs.append(log));
      this.persist((repo) => repo.cardStates.put(progress));
    });
    this.set({ xp: Math.round((this.view.xp + xp) * 1000) / 1000 });
  }

  private end(completed: boolean) {
    const config = this.view.config;
    if (!config || !this.state || this.view.status !== 'running') return;
    this.teardown();
    const results = this.state.results;
    const summary = summarizeRun(results);
    const nextBpm = config.adaptiveBpm ? adaptBpm(config.spec.bpm, results.map(stepClean)) : null;
    this.set({ status: 'summary', summary, nextBpm });
    this.persistSession(summary);
    if (this.sessionId) {
      const result: RunResult = {
        config,
        sessionId: this.sessionId,
        results: [...results],
        logs: [...this.logs],
        summary,
        xp: this.view.xp,
        completed,
      };
      for (const cb of [...this.finishCallbacks]) cb(result);
    }
  }

  private persistSession(summary: RunSummary | null) {
    const config = this.view.config;
    const id = this.sessionId;
    if (!config || !id) return;
    const record = {
      id,
      startedAt: this.startedAt,
      endedAt: summary ? this.deps.wallNow() : null,
      kind: 'practice' as const,
      config: {
        kind: 'progression',
        runKind: config.kind,
        source: config.source.id,
        bpm: config.spec.bpm,
        ...config.config,
        ...(summary
          ? {
              run: {
                total: summary.total,
                correct: summary.correct,
                missed: summary.missed,
                cleanRate: summary.cleanRate,
                meanOffsetMs: summary.meanOffsetMs,
                stdevOffsetMs: summary.stdevOffsetMs,
              },
            }
          : {}),
      },
      summary: null,
      xp: this.view.xp,
    };
    this.persist((r) => r.sessions.put(record));
  }

  private safeRepos(): Repositories | null {
    try {
      return this.deps.repos();
    } catch {
      return null;
    }
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
