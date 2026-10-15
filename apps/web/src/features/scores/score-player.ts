import {
  buildFollowPlan,
  type FollowPlan,
  type FollowSummary,
  type HandsMode,
  msPerTick,
  onBeatToleranceMs,
  type Score,
  startTempo,
  startWait,
  stepGapTicks,
  stopTempo,
  summarizeTempo,
  summarizeWait,
  type TempoState,
  type TempoTiming,
  TPQ,
  tempoNoteOn,
  tempoStepClean,
  tempoStepTime,
  tempoTick,
  type WaitState,
  waitCurrent,
  waitNoteOn,
  waitSkipAuto,
} from '@mayochord/core';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Repositories } from '@/storage';
import type { Timers } from '../practice/controller';

/**
 * 曲谱跟弹的控制器（规格第 10 节第 8 条）：
 * - wait 等待模式：当前一组音都按到了才往下走；另一只手的音在轮到时由网页弹出；
 * - tempo 跟拍模式：节拍器预备一小节后按固定速度往下走，逐音判定早晚、漏弹、多按；
 * - listen 试听：网页按速度弹出这一段（两只手），不判定。
 * 判定都在 core（startWait / tempoNoteOn …），这里只负责接输入、计时、发声、保存。
 */

export type ScoreMode = 'wait' | 'tempo' | 'listen';

export interface ScorePlayConfig {
  scoreId: string;
  score: Score;
  mode: ScoreMode;
  hands: HandsMode;
  /** 另一只手：网页弹出或静音 */
  otherHand: 'play' | 'mute';
  /** 小节下标（含两端） */
  from: number;
  to: number;
  /** 相对谱上速度的比例（0.25–1.5） */
  speed: number;
  /** 弹几遍；null = 一直循环 */
  loops: number | null;
  /** 跟拍模式：预备拍之后节拍器继续响 */
  metronome: boolean;
  /** 按反复记号展开后的演奏顺序弹 */
  expandRepeats: boolean;
  /** 延迟校准的偏移（毫秒） */
  latencyMs: number;
}

export interface MetronomeLike {
  /** 第 0 拍（这一段开始）的时刻，performance.now() 域 */
  startT: number;
  stop(): void;
}

export type NoteMark = 'ok' | 'bad';

export interface PlayerView {
  status: 'idle' | 'starting' | 'running' | 'summary' | 'error';
  error: 'empty' | 'audio' | null;
  config: ScorePlayConfig | null;
  plan: FollowPlan | null;
  /** 等待模式：当前一组（全局序号，跨循环） */
  k: number;
  /** 等待模式：当前一组已经按到的音、按错的音 */
  pressed: number[];
  wrong: number[];
  /** 这一遍里已经有成绩的音（五线谱、瀑布流着色） */
  marks: ReadonlyMap<number, NoteMark>;
  /** 跟拍、试听：第 0 拍的时刻与每 tick 的毫秒数 */
  clock: { startT: number; msPerTick: number } | null;
  summary: FollowSummary | null;
  xp: number;
  saveError: boolean;
}

const IDLE: PlayerView = {
  status: 'idle',
  error: null,
  config: null,
  plan: null,
  k: 0,
  pressed: [],
  wrong: [],
  marks: new Map(),
  clock: null,
  summary: null,
  xp: 0,
  saveError: false,
};

export interface PlayerDeps {
  /** 按下的音（已校准、已合并），t 为事件时间戳 */
  onNoteOn: (cb: (pitch: number, t: number) => void) => () => void;
  startMetronome: (opts: {
    bpm: number;
    beatsPerBar: number;
    countInBeats: number;
    click: boolean;
  }) => Promise<MetronomeLike>;
  /** 加载钢琴音源（需要网页发声时在开始前调用） */
  preparePiano: () => Promise<void>;
  /** 马上弹出 */
  playNow: (pitches: readonly number[], durMs: number) => void;
  /** 在 performance.now() 域的某个时刻弹出 */
  playAt: (pitches: readonly number[], perfT: number, durMs: number) => void;
  /** 停止所有网页发出的声音 */
  silence: () => void;
  repos: () => Repositories | null;
  now: () => number;
  wallNow: () => number;
  uuid: () => string;
  timers?: Timers;
}

const GLOBAL_TIMERS: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const TICK_MS = 40;
/** 跟拍、试听：提前这么久安排网页要弹的音 */
const LOOKAHEAD_MS = 400;
/** 等待模式里一组最多算 20 秒的练习时间（XP） */
const MAX_STEP_MS = 20_000;

/** 四分音符的速度 */
export function effectiveBpm(score: Score, speed: number): number {
  return Math.max(20, Math.round(score.tempo * speed));
}

export class ScorePlayer {
  readonly store: StoreApi<PlayerView> = createStore<PlayerView>()(() => IDLE);
  private readonly timers: Timers;
  private generation = 0;
  private wait: WaitState | null = null;
  private tempo: TempoState | null = null;
  private listenTiming: Pick<TempoState, 'plan' | 'timing'> | null = null;
  private metronome: MetronomeLike | null = null;
  private unsubscribe: (() => void) | null = null;
  private tickTimer: unknown = null;
  private autoTimer: unknown = null;
  /** 跟拍、试听：下一组要安排发声的全局序号 */
  private nextAuto = 0;
  private startedAt = 0;
  private pending: Promise<unknown>[] = [];

  constructor(private readonly deps: PlayerDeps) {
    this.timers = deps.timers ?? GLOBAL_TIMERS;
  }

  get view(): PlayerView {
    return this.store.getState();
  }

  private set(patch: Partial<PlayerView>) {
    this.store.setState(patch);
  }

  async start(config: ScorePlayConfig): Promise<void> {
    this.dispose();
    const gen = ++this.generation;
    const plan = buildFollowPlan(
      config.score,
      config.hands,
      config.from,
      config.to,
      config.expandRepeats,
    );
    const userNotes = plan.steps.some((s) => s.notes.length > 0);
    if (plan.steps.length === 0 || (config.mode !== 'listen' && !userNotes)) {
      this.set({ ...IDLE, status: 'error', error: 'empty', config });
      return;
    }
    this.set({ ...IDLE, status: 'starting', config, plan });
    const needsPiano =
      config.mode === 'listen' ||
      (config.otherHand === 'play' && plan.steps.some((s) => s.auto.length));
    try {
      if (needsPiano) await this.deps.preparePiano();
    } catch {
      // 钢琴音源加载失败：等待/跟拍照样可以练，只是另一只手不出声
      if (config.mode === 'listen') {
        if (gen === this.generation) this.set({ status: 'error', error: 'audio' });
        return;
      }
    }
    if (gen !== this.generation) return;
    this.startedAt = this.deps.wallNow();
    if (config.mode === 'wait') {
      this.wait = startWait(plan, config.loops, this.deps.now());
      this.set({ status: 'running' });
      this.unsubscribe = this.deps.onNoteOn((p, t) => this.onWaitNote(p, t));
      this.arrive();
      return;
    }

    const bpm = effectiveBpm(config.score, config.speed);
    const first = config.score.measures[plan.segments[0]?.measure ?? plan.from];
    const barBeats = first ? Math.max(1, Math.round((first.beats * 4) / first.beatType)) : 4;
    let metronome: MetronomeLike;
    try {
      metronome = await this.deps.startMetronome({
        bpm,
        beatsPerBar: barBeats,
        countInBeats: Math.max(2, barBeats),
        click: config.mode === 'tempo' && config.metronome,
      });
    } catch {
      if (gen === this.generation) this.set({ status: 'error', error: 'audio' });
      return;
    }
    if (gen !== this.generation) {
      metronome.stop();
      return;
    }
    this.metronome = metronome;
    const beatMs = 60_000 / bpm;
    const timing: TempoTiming = {
      startT: metronome.startT,
      msPerTick: msPerTick(bpm),
      latencyMs: config.latencyMs,
      // 离谱上的音多远以内可以配对：半拍，限制在 120–250 ms
      matchWindowMs: Math.max(120, Math.min(250, beatMs / 2)),
      toleranceMs: onBeatToleranceMs(beatMs),
    };
    this.nextAuto = 0;
    if (config.mode === 'tempo') {
      this.tempo = startTempo(plan, config.loops, timing);
      this.unsubscribe = this.deps.onNoteOn((p, t) => this.onTempoNote(p, t));
    } else {
      this.listenTiming = { plan, timing };
    }
    this.set({ status: 'running', clock: { startT: timing.startT, msPerTick: timing.msPerTick } });
    this.scheduleAuto();
    this.scheduleTick();
  }

  /** 手动结束（只总结已经有成绩的部分） */
  stop() {
    if (this.view.status !== 'running') return;
    if (this.tempo) this.tempo = stopTempo(this.tempo);
    this.end(false);
  }

  /** 离开页面 */
  dispose() {
    this.generation++;
    this.teardown();
    this.wait = null;
    this.tempo = null;
    this.listenTiming = null;
    this.set(IDLE);
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.pending);
  }

  private teardown() {
    for (const t of [this.tickTimer, this.autoTimer]) if (t) this.timers.clear(t);
    this.tickTimer = null;
    this.autoTimer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.metronome?.stop();
    this.metronome = null;
  }

  // ───────────── 等待模式 ─────────────

  /** 轮到当前一组：另一只手的音弹出来；只有另一只手的组过一会儿自动往下走 */
  private arrive() {
    const s = this.wait;
    const config = this.view.config;
    if (!s || !config) return;
    const step = waitCurrent(s);
    if (!step) return;
    const mspt = msPerTick(effectiveBpm(config.score, config.speed));
    if (config.otherHand === 'play' && step.auto.length) {
      const dur = Math.max(...step.auto.map((n) => n.dur)) * mspt;
      this.deps.playNow(
        step.auto.map((n) => n.pitch),
        Math.min(dur, 4000),
      );
    }
    if (step.notes.length === 0) {
      const gap = stepGapTicks(s.plan, s.k) * mspt;
      this.autoTimer = this.timers.set(() => {
        this.autoTimer = null;
        if (!this.wait) return;
        this.wait = waitSkipAuto(this.wait, this.deps.now());
        this.afterWaitStep(s);
      }, gap);
    }
  }

  private onWaitNote(pitch: number, t: number) {
    const s = this.wait;
    if (!s) return;
    const next = waitNoteOn(s, pitch, t);
    if (next === s) return;
    this.wait = next;
    this.afterWaitStep(s);
  }

  private afterWaitStep(prev: WaitState) {
    const s = this.wait;
    if (!s) return;
    const advanced = s.k !== prev.k;
    let marks = this.view.marks;
    if (advanced) {
      const len = s.plan.steps.length;
      // 新的一遍开始：清掉上一遍的标记
      const fresh = Math.floor(s.k / len) !== Math.floor(prev.k / len);
      const m = new Map(fresh ? [] : marks);
      const r = s.results[s.results.length - 1];
      const step = prev.plan.steps[prev.k % len];
      if (!fresh && r && r.k === prev.k && step) {
        for (const n of step.notes) m.set(n.id, r.correct ? 'ok' : 'bad');
      }
      marks = m;
    }
    this.set({ k: s.k, pressed: s.pressed, wrong: s.wrong, marks });
    if (s.finished) this.end(true);
    else if (advanced) this.arrive();
  }

  // ───────────── 跟拍、试听 ─────────────

  private onTempoNote(pitch: number, t: number) {
    if (!this.tempo) return;
    this.applyTempo(tempoNoteOn(this.tempo, pitch, t));
  }

  private applyTempo(next: TempoState) {
    const prev = this.tempo;
    if (!prev || next === prev) return;
    this.tempo = next;
    if (next.results.length !== prev.results.length) {
      const len = next.plan.steps.length;
      let m = new Map(this.view.marks);
      for (const r of next.results.slice(prev.results.length)) {
        if (r.index === 0 && r.k > 0) m = new Map();
        const step = next.plan.steps[r.k % len];
        if (!step) continue;
        const clean = tempoStepClean(r);
        for (const n of step.notes) {
          m.set(
            n.id,
            clean || (!r.missed.includes(n.pitch) && r.extras.length === 0) ? 'ok' : 'bad',
          );
        }
      }
      this.set({ marks: m });
    }
    if (next.finished) this.end(true);
  }

  private scheduleTick() {
    this.tickTimer = this.timers.set(() => {
      this.tickTimer = null;
      const now = this.deps.now();
      if (this.tempo) this.applyTempo(tempoTick(this.tempo, now));
      else if (this.listenTiming) {
        const config = this.view.config;
        const { plan, timing } = this.listenTiming;
        if (config?.loops != null) {
          const end = timing.startT + plan.length * config.loops * timing.msPerTick;
          if (now > end + 300) {
            this.end(true);
            return;
          }
        }
      }
      if (this.view.status === 'running') this.scheduleTick();
    }, TICK_MS);
  }

  /** 跟拍、试听：提前安排网页要弹的音 */
  private scheduleAuto() {
    const config = this.view.config;
    const base = this.tempo ?? this.listenTiming;
    if (!config || !base) return;
    const { plan, timing } = base;
    const total =
      config.loops === null ? Number.POSITIVE_INFINITY : plan.steps.length * config.loops;
    const horizon = this.deps.now() + LOOKAHEAD_MS;
    while (this.nextAuto < total) {
      const t = tempoStepTime(base, this.nextAuto);
      if (t > horizon) break;
      const step = plan.steps[this.nextAuto % plan.steps.length];
      this.nextAuto++;
      if (!step) continue;
      const notes =
        config.mode === 'listen'
          ? [...step.notes, ...step.auto]
          : config.otherHand === 'play'
            ? step.auto
            : [];
      if (!notes.length || t < this.deps.now() - 20) continue;
      const dur = Math.min(4000, Math.max(...notes.map((n) => n.dur)) * timing.msPerTick);
      this.deps.playAt(
        notes.map((n) => n.pitch),
        t,
        dur,
      );
    }
    this.autoTimer = this.timers.set(() => {
      this.autoTimer = null;
      if (this.view.status === 'running') this.scheduleAuto();
    }, LOOKAHEAD_MS / 2);
  }

  // ───────────── 结束与保存 ─────────────

  private end(completed: boolean) {
    const config = this.view.config;
    if (!config || this.view.status !== 'running') return;
    this.teardown();
    if (!completed && config.mode !== 'listen') this.deps.silence();
    if (config.mode === 'listen') {
      this.listenTiming = null;
      this.set({ status: 'idle', clock: null });
      return;
    }
    let summary: FollowSummary;
    let xp: number;
    if (this.wait) {
      const results = this.wait.results;
      summary = summarizeWait(results);
      xp = results.reduce((s, r) => s + Math.min(r.ms, MAX_STEP_MS), 0) / 60_000;
    } else if (this.tempo) {
      const results = this.tempo.results;
      summary = summarizeTempo(results);
      const last = results[results.length - 1];
      const played = last ? tempoStepTime(this.tempo, last.k) - this.tempo.timing.startT : 0;
      xp = Math.max(0, played) / 60_000;
    } else return;
    xp = Math.round(xp * 1000) / 1000;
    this.set({ status: 'summary', summary, xp });
    if (summary.total > 0) this.persist(config, summary, xp);
  }

  private persist(config: ScorePlayConfig, summary: FollowSummary, xp: number) {
    const repos = this.safeRepos();
    if (!repos) {
      this.set({ saveError: true });
      return;
    }
    const endedAt = this.deps.wallNow();
    const id = this.deps.uuid();
    const bpm = config.mode === 'tempo' ? effectiveBpm(config.score, config.speed) : null;
    const writes = [
      repos.scores.addRun({
        id,
        scoreId: config.scoreId,
        startedAt: this.startedAt,
        endedAt,
        mode: config.mode === 'tempo' ? 'tempo' : 'wait',
        hands: config.hands,
        from: config.from,
        to: config.to,
        bpm,
        summary,
        xp,
      }),
      repos.scores.update(config.scoreId, { lastPlayedAt: endedAt }),
      // 练习记录：今天的 XP、连续天数都从这里来
      repos.sessions.put({
        id,
        startedAt: this.startedAt,
        endedAt,
        kind: 'practice',
        config: {
          kind: 'score',
          scoreId: config.scoreId,
          mode: config.mode,
          hands: config.hands,
          bpm,
        },
        summary: null,
        xp,
      }),
    ];
    for (const w of writes) {
      const p = w.catch(() => this.set({ saveError: true }));
      this.pending.push(p);
      void p.finally(() => {
        this.pending = this.pending.filter((x) => x !== p);
      });
    }
  }

  private safeRepos(): Repositories | null {
    try {
      return this.deps.repos();
    } catch {
      return null;
    }
  }
}

/** 界面用：当前演奏到的位置（tick）。等待模式是当前一组；跟拍/试听按时钟算（预备拍里小于段落开头） */
export function playheadTick(view: PlayerView, now: number): number | null {
  const plan = view.plan;
  if (!plan || view.status !== 'running') return null;
  if (view.clock) {
    const elapsed = (now - view.clock.startT) / view.clock.msPerTick;
    if (elapsed < 0) return plan.start + elapsed;
    return plan.start + (elapsed % plan.length);
  }
  const step = plan.steps[view.k % plan.steps.length];
  return step ? step.tick : null;
}

/** 预备拍还剩几拍（跟拍、试听）；不在预备拍里为 null */
export function countInBeatsLeft(view: PlayerView, now: number): number | null {
  if (!view.clock || view.status !== 'running') return null;
  const beats = (view.clock.startT - now) / (view.clock.msPerTick * TPQ);
  return beats > 0 ? Math.ceil(beats) : null;
}
