import { mean, stdev } from '../timing';
import { type Hand, type Score, type ScoreMeasure, type ScoreNote, TPQ } from './model';

/**
 * 曲谱跟弹的判定（规格第 10 节第 8 条），纯函数。逐音判定，不等和弦"弹稳"。
 * - 等待模式：当前一组音都按到了才往下走；之前按错的音让这一组记为"有错"。
 * - 跟拍模式：每个按下的音与时间最近、音高相同、还没配对的谱上音配对，记录早晚；
 *   配不上的算多按；时间过了还没配上的算漏弹。
 */

export type HandsMode = 'both' | 'left' | 'right';

export interface FollowStep {
  /** 在这一段里的序号 */
  index: number;
  tick: number;
  measure: number;
  /** 要自己弹的音 */
  notes: ScoreNote[];
  /** 另一只手的音（网页代弹或静音） */
  auto: ScoreNote[];
}

export interface FollowPlan {
  steps: FollowStep[];
  /** 这一段开始、长度（tick） */
  start: number;
  length: number;
  from: number;
  to: number;
}

const playsHand = (hands: HandsMode, hand: Hand) => hands === 'both' || hands === hand;

/** 把 from…to 小节（含）里的音按起音分组。没有音的段落返回空的 steps。 */
export function buildFollowPlan(
  score: Score,
  hands: HandsMode,
  from: number,
  to: number,
): FollowPlan {
  const last = score.measures.length - 1;
  const a = Math.max(0, Math.min(from, last));
  const b = Math.max(a, Math.min(to, last));
  const first = score.measures[a] as ScoreMeasure;
  const end = score.measures[b] as ScoreMeasure;
  const start = first.start;
  const length = end.start + end.length - start;
  const byTick = new Map<number, FollowStep>();
  for (const n of score.notes) {
    if (n.measure < a || n.measure > b) continue;
    let step = byTick.get(n.start);
    if (!step) {
      step = { index: 0, tick: n.start, measure: n.measure, notes: [], auto: [] };
      byTick.set(n.start, step);
    }
    (playsHand(hands, n.hand) ? step.notes : step.auto).push(n);
  }
  const steps = [...byTick.values()].sort((x, y) => x.tick - y.tick);
  steps.forEach((s, i) => {
    s.index = i;
  });
  return { steps, start, length, from: a, to: b };
}

/** 四分音符 BPM → 每 tick 的毫秒数 */
export const msPerTick = (bpm: number) => 60_000 / bpm / TPQ;

const totalSteps = (plan: FollowPlan, loops: number | null) =>
  loops === null ? Number.POSITIVE_INFINITY : plan.steps.length * loops;

const stepAt = (plan: FollowPlan, k: number) => plan.steps[k % plan.steps.length] as FollowStep;

// ───────────────────────────── 等待模式 ─────────────────────────────

export interface WaitStepResult {
  k: number;
  index: number;
  measure: number;
  /** 没按错就弹完了这一组 */
  correct: boolean;
  wrongNotes: number[];
  /** 从轮到这一组到弹完（毫秒） */
  ms: number;
}

export interface WaitState {
  plan: FollowPlan;
  loops: number | null;
  /** 当前一组的全局序号（跨循环连续编号） */
  k: number;
  /** 这一组已经按到的音 */
  pressed: number[];
  /** 这一组按错的音 */
  wrong: number[];
  activatedAt: number;
  results: WaitStepResult[];
  finished: boolean;
}

export function startWait(plan: FollowPlan, loops: number | null, t: number): WaitState {
  return {
    plan,
    loops,
    k: 0,
    pressed: [],
    wrong: [],
    activatedAt: t,
    results: [],
    finished: plan.steps.length === 0,
  };
}

export function waitCurrent(s: WaitState): FollowStep | null {
  return s.finished ? null : stepAt(s.plan, s.k);
}

/** 这一组还没按到的音 */
export function waitRemaining(s: WaitState): number[] {
  const step = waitCurrent(s);
  if (!step) return [];
  return [...new Set(step.notes.map((n) => n.pitch))].filter((p) => !s.pressed.includes(p));
}

function advance(s: WaitState, t: number, result: WaitStepResult | null): WaitState {
  const k = s.k + 1;
  return {
    ...s,
    k,
    pressed: [],
    wrong: [],
    activatedAt: t,
    results: result ? [...s.results, result] : s.results,
    finished: k >= totalSteps(s.plan, s.loops),
  };
}

export function waitNoteOn(s: WaitState, pitch: number, t: number): WaitState {
  const step = waitCurrent(s);
  if (!step || step.notes.length === 0) return s;
  const expected = new Set(step.notes.map((n) => n.pitch));
  if (!expected.has(pitch)) {
    return s.wrong.includes(pitch) ? s : { ...s, wrong: [...s.wrong, pitch] };
  }
  if (s.pressed.includes(pitch)) return s;
  const pressed = [...s.pressed, pitch];
  if (pressed.length < expected.size) return { ...s, pressed };
  return advance(s, t, {
    k: s.k,
    index: step.index,
    measure: step.measure,
    correct: s.wrong.length === 0,
    wrongNotes: s.wrong,
    ms: Math.max(0, t - s.activatedAt),
  });
}

/** 当前一组只有另一只手的音：放完后往下走（不记成绩） */
export function waitSkipAuto(s: WaitState, t: number): WaitState {
  const step = waitCurrent(s);
  if (!step || step.notes.length > 0) return s;
  return advance(s, t, null);
}

/** 第 k 组之后到下一组的 tick 数（跨循环时回到开头） */
export function stepGapTicks(plan: FollowPlan, k: number): number {
  const cur = stepAt(plan, k);
  const next = stepAt(plan, k + 1);
  const gap = next.tick - cur.tick;
  return gap > 0 ? gap : plan.start + plan.length - cur.tick + (next.tick - plan.start);
}

// ───────────────────────────── 跟拍模式 ─────────────────────────────

export interface TempoTiming {
  /** 这一段开始的时刻（performance.now() 域，第 0 拍） */
  startT: number;
  msPerTick: number;
  /** 延迟校准的偏移 */
  latencyMs: number;
  /** 离谱上的音多远以内可以配对 */
  matchWindowMs: number;
  /** "在拍上"的容差 */
  toleranceMs: number;
}

export interface TempoStepResult {
  k: number;
  index: number;
  measure: number;
  /** 要弹的音数 */
  total: number;
  /** 配对上的音的偏差（毫秒，正 = 晚） */
  offsets: number[];
  /** 在拍上的音数 */
  onBeat: number;
  missed: number[];
  extras: number[];
}

interface PendingStep {
  hits: Map<number, number>;
  extras: number[];
}

export interface TempoState {
  plan: FollowPlan;
  loops: number | null;
  timing: TempoTiming;
  /** 第一个还没定下成绩的组 */
  open: number;
  pending: ReadonlyMap<number, PendingStep>;
  results: TempoStepResult[];
  finished: boolean;
}

/** 推迟一点再关窗口，避免事件处理的先后让刚好在窗口内的音被算成漏弹 */
const CLOSE_GRACE_MS = 30;

export function tempoStepTime(s: Pick<TempoState, 'plan' | 'timing'>, k: number): number {
  const { plan, timing } = s;
  const loop = Math.floor(k / plan.steps.length);
  const step = stepAt(plan, k);
  return timing.startT + (loop * plan.length + step.tick - plan.start) * timing.msPerTick;
}

export function startTempo(
  plan: FollowPlan,
  loops: number | null,
  timing: TempoTiming,
): TempoState {
  return {
    plan,
    loops,
    timing,
    open: 0,
    pending: new Map(),
    results: [],
    finished: plan.steps.length === 0,
  };
}

/** 按下一个音（t 为输入事件的时间戳） */
export function tempoNoteOn(state: TempoState, pitch: number, t: number): TempoState {
  // 先定下窗口已经过去的组，保证 open 就在 t 附近
  const s = tempoTick(state, t);
  if (s.finished) return s;
  const te = t - s.timing.latencyMs;
  const w = s.timing.matchWindowMs;
  // 预备拍里按的不算
  if (s.open === 0 && te < tempoStepTime(s, 0) - w) return s;
  const end = Math.min(totalSteps(s.plan, s.loops), s.open + s.plan.steps.length + 1);
  let best: { k: number; id: number; dt: number } | null = null;
  let nearest: { k: number; d: number } | null = null;
  for (let k = s.open; k < end; k++) {
    const st = tempoStepTime(s, k);
    const d = Math.abs(te - st);
    if (st > te && nearest && d > nearest.d && d > w) break;
    const step = stepAt(s.plan, k);
    if (step.notes.length === 0) continue;
    if (!nearest || d < nearest.d) nearest = { k, d };
    if (d > w) continue;
    const hits = s.pending.get(k)?.hits;
    for (const n of step.notes) {
      if (n.pitch !== pitch || hits?.has(n.id)) continue;
      if (!best || d < Math.abs(best.dt)) best = { k, id: n.id, dt: te - st };
    }
  }
  const pending = new Map(s.pending);
  if (best) {
    const p = pending.get(best.k) ?? { hits: new Map(), extras: [] };
    pending.set(best.k, { hits: new Map(p.hits).set(best.id, best.dt), extras: p.extras });
    return { ...s, pending };
  }
  if (!nearest) return s;
  const p = pending.get(nearest.k) ?? { hits: new Map(), extras: [] };
  pending.set(nearest.k, { hits: p.hits, extras: [...p.extras, pitch] });
  return { ...s, pending };
}

function stepResult(s: TempoState, k: number, p: PendingStep | undefined): TempoStepResult {
  const step = stepAt(s.plan, k);
  const offsets = step.notes.flatMap((n) => {
    const v = p?.hits.get(n.id);
    return v === undefined ? [] : [v];
  });
  return {
    k,
    index: step.index,
    measure: step.measure,
    total: step.notes.length,
    offsets,
    onBeat: offsets.filter((o) => Math.abs(o) <= s.timing.toleranceMs).length,
    missed: step.notes.filter((n) => !p?.hits.has(n.id)).map((n) => n.pitch),
    extras: p?.extras ?? [],
  };
}

/** 定下窗口已经过去的组（now 为 performance.now()） */
export function tempoTick(s: TempoState, now: number): TempoState {
  if (s.finished) return s;
  const te = now - s.timing.latencyMs;
  const total = totalSteps(s.plan, s.loops);
  let open = s.open;
  const results: TempoStepResult[] = [];
  let pending: Map<number, PendingStep> | null = null;
  while (open < total && tempoStepTime(s, open) + s.timing.matchWindowMs + CLOSE_GRACE_MS < te) {
    const step = stepAt(s.plan, open);
    const p = s.pending.get(open);
    if (step.notes.length > 0 || (p && p.extras.length > 0)) results.push(stepResult(s, open, p));
    pending ??= new Map(s.pending);
    pending.delete(open);
    open++;
  }
  if (open === s.open) return s;
  return {
    ...s,
    open,
    pending: pending ?? s.pending,
    results: [...s.results, ...results],
    finished: open >= total,
  };
}

/** 手动结束：已经定下成绩的组，加上窗口还没关、但已经全部弹到的组 */
export function stopTempo(s: TempoState): TempoState {
  if (s.finished) return s;
  const total = totalSteps(s.plan, s.loops);
  const results = [...s.results];
  for (let k = s.open; k < total && k < s.open + s.plan.steps.length; k++) {
    const step = stepAt(s.plan, k);
    if (step.notes.length === 0) continue;
    const p = s.pending.get(k);
    if (!p || p.hits.size < step.notes.length) break;
    results.push(stepResult(s, k, p));
  }
  return { ...s, results, finished: true };
}

export function tempoStepClean(r: TempoStepResult): boolean {
  return r.missed.length === 0 && r.extras.length === 0 && r.onBeat === r.total;
}

// ───────────────────────────── 总结 ─────────────────────────────

export interface MeasureStat {
  measure: number;
  /** 等待模式：组数；跟拍模式：音数 */
  total: number;
  /** 等待模式：有错的组；跟拍模式：漏弹 + 多按 */
  errors: number;
  /** 跟拍模式：配对上但不在拍上的音 */
  offBeat: number;
}

export interface FollowSummary {
  mode: 'wait' | 'tempo';
  total: number;
  /** 等待模式：一次弹对的组；跟拍模式：弹到的音 */
  correct: number;
  missed: number;
  extra: number;
  /** 跟拍模式：在拍上的比例（占弹到的音） */
  onBeatRate: number | null;
  meanOffsetMs: number | null;
  stdevOffsetMs: number | null;
  measures: MeasureStat[];
}

function measureMap(): Map<number, MeasureStat> {
  return new Map();
}

function bump(m: Map<number, MeasureStat>, measure: number, patch: Omit<MeasureStat, 'measure'>) {
  const cur = m.get(measure) ?? { measure, total: 0, errors: 0, offBeat: 0 };
  m.set(measure, {
    measure,
    total: cur.total + patch.total,
    errors: cur.errors + patch.errors,
    offBeat: cur.offBeat + patch.offBeat,
  });
}

const sortedStats = (m: Map<number, MeasureStat>) =>
  [...m.values()].sort((a, b) => a.measure - b.measure);

export function summarizeWait(results: readonly WaitStepResult[]): FollowSummary {
  const m = measureMap();
  for (const r of results) bump(m, r.measure, { total: 1, errors: r.correct ? 0 : 1, offBeat: 0 });
  return {
    mode: 'wait',
    total: results.length,
    correct: results.filter((r) => r.correct).length,
    missed: 0,
    extra: results.reduce((s, r) => s + r.wrongNotes.length, 0),
    onBeatRate: null,
    meanOffsetMs: null,
    stdevOffsetMs: null,
    measures: sortedStats(m),
  };
}

export function summarizeTempo(results: readonly TempoStepResult[]): FollowSummary {
  const m = measureMap();
  const offsets = results.flatMap((r) => r.offsets);
  for (const r of results) {
    bump(m, r.measure, {
      total: r.total,
      errors: r.missed.length + r.extras.length,
      offBeat: r.offsets.length - r.onBeat,
    });
  }
  const onBeat = results.reduce((s, r) => s + r.onBeat, 0);
  const sd = stdev(offsets);
  const avg = mean(offsets);
  return {
    mode: 'tempo',
    total: results.reduce((s, r) => s + r.total, 0),
    correct: offsets.length,
    missed: results.reduce((s, r) => s + r.missed.length, 0),
    extra: results.reduce((s, r) => s + r.extras.length, 0),
    onBeatRate: offsets.length ? onBeat / offsets.length : null,
    meanOffsetMs: avg === null ? null : Math.round(avg),
    stdevOffsetMs: sd === null ? null : Math.round(sd),
    measures: sortedStats(m),
  };
}

/** 一个小节的错误率：错误 / 总数（跟拍模式不在拍上算半个错误） */
export function measureErrorRate(s: MeasureStat): number {
  if (s.total === 0) return s.errors > 0 ? 1 : 0;
  return Math.min(1, (s.errors + s.offBeat * 0.5) / s.total);
}

/** 多次练习合起来最容易出错的小节（至少练过 minTotal 次、有错误），错误率从高到低 */
export function worstMeasures(
  runs: readonly (readonly MeasureStat[])[],
  limit = 5,
  minTotal = 3,
): (MeasureStat & { rate: number })[] {
  const m = measureMap();
  for (const run of runs) for (const s of run) bump(m, s.measure, s);
  return [...m.values()]
    .filter((s) => s.total >= minTotal && s.errors + s.offBeat > 0)
    .map((s) => ({ ...s, rate: measureErrorRate(s) }))
    .sort((a, b) => b.rate - a.rate || a.measure - b.measure)
    .slice(0, limit);
}
