import type { LoadedPack, RhythmEntry } from '@mayochord/content';
import {
  type AnyCard,
  bpmToBeatMs,
  type CardProgress,
  type Evidence,
  emptyProgress,
  gradeRhythm,
  type InputSourceKind,
  judgeRhythm,
  onBeatToleranceMs,
  type Rating,
  type ReviewLog,
  type RhythmCard,
  type RhythmJudge,
  type SchedulingStrategy,
  type SessionSummary,
  summarizeSession,
  TPQ,
  trialXp,
} from '@mayochord/core';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { RhythmPlayback } from '@/audio/rhythm-play';
import type { OnsetMark } from '@/design/staff/StaffLine';
import type { SessionResult, SessionSpec } from '@/features/practice/controller';
import type { Repositories } from '@/storage';

/**
 * 节奏读谱的一轮练习（M10）：每张卡 = 一小节节奏。
 * 预备一小节后跟着节拍器在任意键上按出每个音的起点 → 判定（core 的 judgeRhythm）→ 评分、写日志、
 * 更新卡片进度 → 下一张。结束时给出和 PracticeController 一样的 SessionResult，
 * 课程、每日任务、测验都可以照常记录。
 */

export type RhythmPhase = 'ready' | 'demo' | 'countIn' | 'playing' | 'judged';

export interface RhythmView {
  status: 'idle' | 'loading' | 'running' | 'summary' | 'empty';
  spec: SessionSpec | null;
  sessionId: string | null;
  card: RhythmCard | null;
  rhythm: RhythmEntry | null;
  phase: RhythmPhase;
  /** 节拍器的拍（预备拍为负数），没有在响时为 null */
  beat: number | null;
  /** 自己弹的这一遍的节拍网格（第 0 拍 = 预备小节之后，performance.now() 域）；测试也用它按时输入 */
  grid: { startT: number; beatMs: number } | null;
  /** 每个起点的标记 */
  marks: OnsetMark[];
  judge: RhythmJudge | null;
  rating: Rating | null;
  /** 这一张卡是先听了示范的（引导练习、第一次见到的卡） */
  demoed: boolean;
  index: number;
  length: number;
  correctCount: number;
  xp: number;
  summary: SessionSummary | null;
  saveError: boolean;
}

const IDLE: RhythmView = {
  status: 'idle',
  spec: null,
  sessionId: null,
  card: null,
  rhythm: null,
  phase: 'ready',
  beat: null,
  grid: null,
  marks: [],
  judge: null,
  rating: null,
  demoed: false,
  index: 0,
  length: 0,
  correctCount: 0,
  xp: 0,
  summary: null,
  saveError: false,
};

export interface RhythmDeps {
  pack: LoadedPack;
  repos: () => Repositories | null;
  strategy: () => SchedulingStrategy;
  /** 播放一小节（预备一小节；demo = true 时连每个起点一起敲） */
  play: (
    rhythm: RhythmEntry,
    demo: boolean,
    onBeat: (beat: number) => void,
  ) => Promise<RhythmPlayback>;
  /** 订阅按下的音（已校准），t 为 performance.now() 域 */
  onNoteOn: (cb: (t: number, source: string) => void) => () => void;
  latencyMs: () => number;
  now: () => number;
  wallNow: () => number;
  uuid: () => string;
  /** 输入源 → 日志里的 inputSource */
  sourceKind: (source: string) => InputSourceKind;
  onResult?: (correct: boolean) => void;
  timers?: { set(fn: () => void, ms: number): unknown; clear(h: unknown): void };
}

const GLOBAL_TIMERS = {
  set: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** 两张卡之间、示范与自己弹之间的停顿 */
const GAP_MS = 900;
/** 结果显示多久（答错多显示一会儿） */
const SHOW_OK_MS = 1400;
const SHOW_WRONG_MS = 2600;
/** 窗口外的按键不算（预备拍里的、小节结束很久之后的） */
const EDGE_MS = 250;

function shuffle<T>(xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

export class RhythmSessionController {
  readonly store: StoreApi<RhythmView> = createStore<RhythmView>()(() => IDLE);
  private spec: SessionSpec | null = null;
  private strategy: SchedulingStrategy | null = null;
  private progress = new Map<string, CardProgress>();
  private queue: RhythmCard[] = [];
  private evidence: Evidence[] = [];
  private logs: ReviewLog[] = [];
  private seen = new Set<string>();
  private playback: RhythmPlayback | null = null;
  private timer: unknown = null;
  private taps: { t: number; source: string }[] = [];
  private unsubscribe: (() => void) | null = null;
  private generation = 0;
  private startedAt = 0;
  private finishCallbacks: ((r: SessionResult) => void)[] = [];
  private readonly timers;

  constructor(private readonly deps: RhythmDeps) {
    this.timers = deps.timers ?? GLOBAL_TIMERS;
  }

  get view(): RhythmView {
    return this.store.getState();
  }

  private set(patch: Partial<RhythmView>) {
    this.store.setState(patch);
  }

  onFinish(cb: (r: SessionResult) => void): () => void {
    this.finishCallbacks.push(cb);
    return () => {
      this.finishCallbacks = this.finishCallbacks.filter((x) => x !== cb);
    };
  }

  async start(spec: SessionSpec): Promise<void> {
    this.dispose();
    const gen = ++this.generation;
    const cards = spec.cards.filter((c): c is RhythmCard => c.kind === 'rhythm');
    this.set({ ...IDLE, status: 'loading', spec });
    if (cards.length === 0) {
      this.set({ status: 'empty' });
      return;
    }
    const repos = this.safeRepos();
    let progress = new Map<string, CardProgress>();
    let saveError = repos === null;
    try {
      if (repos) progress = await repos.cardStates.getMany(cards.map((c) => c.id));
    } catch {
      saveError = true;
    }
    if (gen !== this.generation) return;
    this.spec = spec;
    this.strategy = this.deps.strategy();
    this.progress = progress;
    this.evidence = [];
    this.logs = [];
    this.seen = new Set([...progress.values()].filter((p) => p.attempts > 0).map((p) => p.cardId));
    // 题目顺序：按顺序（引导、测验）或打乱；不够 length 张时循环
    const order = spec.order === 'sequential' ? cards : shuffle(cards);
    const length = spec.order === 'sequential' ? Math.min(spec.length, cards.length) : spec.length;
    this.queue = Array.from({ length }, (_, i) => order[i % order.length] as RhythmCard);
    this.startedAt = this.deps.wallNow();
    this.set({ status: 'running', sessionId: this.deps.uuid(), length, saveError });
    this.persistSession(null, null);
    this.unsubscribe = this.deps.onNoteOn((t, source) => {
      const phase = this.view.phase;
      if (phase === 'countIn' || phase === 'playing') {
        this.taps.push({ t, source });
        this.updateMarks();
      }
    });
    this.next();
  }

  finish() {
    this.end(false);
  }

  dispose() {
    this.generation++;
    this.finishCallbacks = [];
    this.stopAudio();
    this.clearTimer();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.set(IDLE);
  }

  private safeRepos(): Repositories | null {
    try {
      return this.deps.repos();
    } catch {
      return null;
    }
  }

  private clearTimer() {
    if (this.timer) this.timers.clear(this.timer);
    this.timer = null;
  }

  private stopAudio() {
    this.playback?.stop();
    this.playback = null;
  }

  private later(fn: () => void, ms: number) {
    this.clearTimer();
    const gen = this.generation;
    this.timer = this.timers.set(() => {
      this.timer = null;
      if (gen === this.generation) fn();
    }, ms);
  }

  private next() {
    const spec = this.spec as SessionSpec;
    const done =
      this.queue.length === 0 ||
      (spec.targetCorrect !== undefined && this.view.correctCount >= spec.targetCorrect);
    if (done) {
      this.end(true);
      return;
    }
    const card = this.queue.shift() as RhythmCard;
    const rhythm = this.deps.pack.rhythmById.get(card.rhythmId) ?? null;
    if (!rhythm) {
      this.next();
      return;
    }
    const demo = spec.hints === 'always' || (spec.hints === 'auto' && !this.seen.has(card.id));
    this.set({
      card,
      rhythm,
      phase: 'ready',
      beat: null,
      grid: null,
      marks: rhythm.pattern.onsets.map(() => null),
      judge: null,
      rating: null,
      demoed: demo,
      index: this.view.index + 1,
    });
    this.later(() => void (demo ? this.runDemo() : this.runTurn()), GAP_MS);
  }

  private async runDemo() {
    const { rhythm } = this.view;
    if (!rhythm) return;
    const gen = this.generation;
    this.set({ phase: 'demo' });
    try {
      const pb = await this.deps.play(rhythm, true, (beat) => {
        if (gen === this.generation) this.set({ beat });
      });
      if (gen !== this.generation) {
        pb.stop();
        return;
      }
      this.playback = pb;
      const end =
        pb.metronome.grid.startT + (rhythm.pattern.length / TPQ) * pb.metronome.grid.beatMs;
      this.later(
        () => {
          this.stopAudio();
          void this.runTurn();
        },
        end - this.deps.now() + GAP_MS,
      );
    } catch {
      void this.runTurn();
    }
  }

  private async runTurn() {
    const { rhythm } = this.view;
    if (!rhythm) return;
    const gen = this.generation;
    this.taps = [];
    this.set({
      phase: 'countIn',
      beat: null,
      grid: null,
      marks: rhythm.pattern.onsets.map(() => null),
    });
    let pb: RhythmPlayback;
    try {
      pb = await this.deps.play(rhythm, false, (beat) => {
        if (gen !== this.generation) return;
        this.set({ beat, phase: beat < 0 ? 'countIn' : 'playing' });
        this.updateMarks();
      });
    } catch {
      // 声音放不出来：没有节拍器无法判定，直接跳过这一轮
      this.set({ saveError: this.view.saveError });
      this.end(false);
      return;
    }
    if (gen !== this.generation) {
      pb.stop();
      return;
    }
    this.playback = pb;
    const { startT, beatMs } = pb.metronome.grid;
    this.set({ grid: { startT, beatMs } });
    const end = startT + (rhythm.pattern.length / TPQ) * beatMs;
    this.later(() => this.judge(startT, beatMs), end - this.deps.now() + EDGE_MS);
  }

  /** 演奏中：已经过去的起点标成"当前 / 按到 / 漏了"（只是提示，成绩以最后的判定为准） */
  private updateMarks() {
    const { rhythm, phase } = this.view;
    const grid = this.playback?.metronome.grid;
    if (!rhythm || !grid || phase !== 'playing') return;
    const now = this.deps.now();
    const beatMs = grid.beatMs;
    const marks: OnsetMark[] = rhythm.pattern.onsets.map((tick) => {
      const t = grid.startT + (tick / TPQ) * beatMs;
      return Math.abs(now - t) < beatMs / 2 ? 'current' : null;
    });
    this.set({ marks });
  }

  private judge(startT: number, beatMs: number) {
    this.stopAudio();
    const { rhythm, card } = this.view;
    const spec = this.spec as SessionSpec;
    if (!rhythm || !card) return;
    const latency = this.deps.latencyMs();
    const lengthMs = (rhythm.pattern.length / TPQ) * beatMs;
    const taps = this.taps
      .map((x) => ({ ...x, rel: x.t - latency - startT }))
      .filter((x) => x.rel >= -EDGE_MS && x.rel <= lengthMs + EDGE_MS);
    const expected = rhythm.pattern.onsets.map((tick) => (tick / TPQ) * beatMs);
    const j = judgeRhythm(
      expected,
      taps.map((x) => x.rel),
      onBeatToleranceMs(beatMs),
    );
    const hintUsed = this.view.demoed;
    const rating = gradeRhythm(j, hintUsed);
    const offsets = j.hits.flatMap((h) => (h.offset === null ? [] : [h.offset]));
    const meanOffset =
      offsets.length > 0 ? offsets.reduce((s, x) => s + x, 0) / offsets.length : null;
    const sources = taps.map((x) => this.deps.sourceKind(x.source));
    const inputSource = sources.find((s) => s !== 'midi') ?? 'midi';
    const ev: Evidence = {
      cardId: card.id,
      cardKind: 'rhythm',
      drillType: 'rhythm-reading',
      correct: j.correct,
      timedOut: false,
      reactionMs: null,
      extraNotes: [],
      missingNotes: [],
      spreadMs: null,
      together: null,
      hintUsed,
      inputSource,
    };
    const xp = Math.round(trialXp(lengthMs + beatMs * 4, false) * 1000) / 1000;
    const log: ReviewLog = {
      id: this.deps.uuid(),
      ts: this.deps.wallNow(),
      sessionId: this.view.sessionId,
      cardId: card.id,
      cardKind: 'rhythm',
      drillType: 'rhythm-reading',
      evidence: 'explicit',
      weight: 1,
      correct: j.correct,
      reactionMs: null,
      extraNotes: [],
      missingNotes: [],
      spreadMs: null,
      beatOffsetMs: meanOffset === null ? null : Math.round(meanOffset),
      hintUsed,
      rating,
      inputSource,
      contentVersion: this.deps.pack.version,
      xp,
      mashing: false,
    };
    const strategy = this.strategy as SchedulingStrategy;
    const progress = strategy.applyLog(this.progress.get(card.id) ?? emptyProgress(card.id), log);
    this.progress.set(card.id, progress);
    this.evidence.push(ev);
    this.logs.push(log);
    this.seen.add(card.id);
    this.persist((r) => r.reviewLogs.append(log));
    this.persist((r) => r.cardStates.put(progress));
    // 答错的卡几张之后再来一次
    if (!j.correct && spec.retryWrong) {
      this.queue.splice(Math.min(this.queue.length, 2), 0, card);
    }
    const marks: OnsetMark[] = j.hits.map((h) =>
      h.tap === null ? 'missed' : h.onBeat ? 'ok' : 'off',
    );
    this.set({
      phase: 'judged',
      beat: null,
      judge: j,
      rating,
      marks,
      xp: this.view.xp + xp,
      correctCount: this.view.correctCount + (j.correct ? 1 : 0),
    });
    this.deps.onResult?.(j.correct);
    this.later(() => this.next(), j.correct ? SHOW_OK_MS : SHOW_WRONG_MS);
  }

  private end(completed: boolean) {
    if (this.view.status !== 'running') return;
    this.stopAudio();
    this.clearTimer();
    this.unsubscribe?.();
    this.unsubscribe = null;
    const summary = summarizeSession(this.evidence);
    const { sessionId, xp } = this.view;
    this.set({ status: 'summary', summary, phase: 'ready', beat: null });
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
    write(repos).catch(() => this.set({ saveError: true }));
  }
}

/** 卡片是不是节奏读谱卡（每日任务、诊断等用来分开处理） */
export const isRhythmCard = (c: AnyCard): c is RhythmCard => c.kind === 'rhythm';

export const rhythmBeatMs = (r: RhythmEntry) => bpmToBeatMs(r.bpm);
