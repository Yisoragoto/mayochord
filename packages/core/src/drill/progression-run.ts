import type { InputSourceKind, Rating } from '../log/review-log';
import type { ChordAttempt } from '../recognition/attempt';
import { type JudgeMode, type JudgeResult, judgeNotes } from '../recognition/judge';
import { type BeatGrid, beatGrid, onBeatToleranceMs } from '../timing/beat-grid';
import { type HistogramBin, histogram, mean, stdev } from '../timing/stats';
import { chordCardId, transitionCardId, type VoicingMode } from './cards';

/**
 * 跟拍弹进行（规格 9、10-5）：节拍器数完预备拍后，按进行的顺序在每个和弦的拍点弹出它。
 * 每个和弦、每次切换都作为显式证据记录给对应的和弦卡、切换卡（规格 6.3）。
 * 这里是纯函数：调用方把实时的和弦尝试（runAttempt）和当前时间（runTick）喂进来。
 */
export interface RunStepSpec {
  chordId: string;
  /** 参考键位的 MIDI 号 */
  target: readonly number[];
  /** 斜杠和弦：宽松判定时也要求最低音正确 */
  slash: boolean;
  /** 这个和弦占几拍 */
  beats: number;
  /** 提前几个 16 分音符换到这个和弦（先行切分，0–3） */
  anticipation: number;
}

export interface RunSpec {
  steps: readonly RunStepSpec[];
  /** 循环几遍；null = 一直弹到手动结束 */
  loops: number | null;
  bpm: number;
  beatsPerBar: number;
  /** 预备拍（节拍器先数这么多拍） */
  countInBeats: number;
  voicingMode: VoicingMode;
  /** 弹的时候是否显示键位（显示时证据记为用过提示） */
  hintsVisible: boolean;
  /** 延迟校准得到的偏移（毫秒），节拍偏差扣除它 */
  latencyMs: number;
  onsetWindowMs: number;
}

/** 进行里第 k 个和弦（跨循环连续编号）排在什么时候 */
export interface ScheduledStep {
  k: number;
  loop: number;
  stepIndex: number;
  chordId: string;
  /** 第一遍的第一个和弦没有"从"和弦 */
  fromChordId: string | null;
  /** 应该弹出的时刻（已含先行切分），performance.now() 域 */
  t: number;
  /** 从这个时刻起的尝试算这一步（前一步与这一步之间的中点，最多提前半拍） */
  windowStart: number;
  /** 节拍网格上的位置（拍，可以是小数） */
  beat: number;
}

export type StepStatus = 'correct' | 'wrong' | 'missed';

export interface StepResult {
  k: number;
  loop: number;
  stepIndex: number;
  chordId: string;
  fromChordId: string | null;
  status: StepStatus;
  /** 第一次判定的音与结果（missed 时为 null） */
  notes: number[] | null;
  judge: JudgeResult | null;
  /** 和弦落下的时刻（这次新按下的音的平均按下时间） */
  onsetT: number | null;
  /** 相对拍点的偏差（毫秒，已扣除延迟校准；正数 = 晚） */
  beatOffsetMs: number | null;
  onBeat: boolean | null;
  spreadMs: number | null;
  together: boolean | null;
  /** 第一次弹错，之后在这一步里改对了（成绩仍按第一次） */
  corrected: boolean;
  inputSource: InputSourceKind;
}

export interface RunState {
  spec: RunSpec;
  grid: BeatGrid;
  /** 下一个还没定下成绩的步 */
  open: number;
  results: StepResult[];
  /** 当前步里只按了一部分的尝试（没多按的音）：等补全；窗口结束时按它判错 */
  partial: { attempt: ChordAttempt; judge: JudgeResult; source: InputSourceKind } | null;
  finished: boolean;
}

const stepsPerLoop = (spec: RunSpec) => spec.steps.length;
const loopBeats = (spec: RunSpec) => spec.steps.reduce((s, x) => s + x.beats, 0);

/** 总共多少步；无限循环为 null */
export const totalSteps = (spec: RunSpec): number | null =>
  spec.loops === null ? null : spec.loops * stepsPerLoop(spec);

/** startT = 第一拍（预备拍之后的第一个强拍）的时刻 */
export function runGrid(spec: RunSpec, startT: number): BeatGrid {
  return beatGrid(startT, spec.bpm, spec.beatsPerBar);
}

function rawStepTime(spec: RunSpec, grid: BeatGrid, k: number): { beat: number; t: number } {
  const n = stepsPerLoop(spec);
  const loop = Math.floor(k / n);
  const i = k % n;
  let beat = loop * loopBeats(spec);
  for (let j = 0; j < i; j++) beat += (spec.steps[j] as RunStepSpec).beats;
  // 第一遍的第一个和弦从第一拍开始（预备拍里不能提前）
  const ant = k === 0 ? 0 : (spec.steps[i] as RunStepSpec).anticipation;
  beat -= ant / 4;
  return { beat, t: grid.startT + beat * grid.beatMs };
}

export function scheduleStep(spec: RunSpec, grid: BeatGrid, k: number): ScheduledStep {
  const n = stepsPerLoop(spec);
  const i = k % n;
  const { beat, t } = rawStepTime(spec, grid, k);
  const half = grid.beatMs / 2;
  const prevT = k === 0 ? t - half * 2 : rawStepTime(spec, grid, k - 1).t;
  const windowStart = t - Math.min(half, (t - prevT) / 2);
  return {
    k,
    loop: Math.floor(k / n),
    stepIndex: i,
    chordId: (spec.steps[i] as RunStepSpec).chordId,
    fromChordId: k === 0 ? null : (spec.steps[(k - 1 + n) % n] as RunStepSpec).chordId,
    t,
    windowStart,
    beat,
  };
}

/** 这一遍结束的时刻（最后一步窗口关闭）：最后一个和弦弹满它的拍数 */
export function runEndT(spec: RunSpec, grid: BeatGrid): number | null {
  const total = totalSteps(spec);
  if (total === null) return null;
  return grid.startT + (spec.loops as number) * loopBeats(spec) * grid.beatMs;
}

export function startRun(spec: RunSpec, startT: number): RunState {
  return {
    spec,
    grid: runGrid(spec, startT),
    open: 0,
    results: [],
    partial: null,
    finished: false,
  };
}

const judgeModeOf = (spec: RunSpec, step: RunStepSpec): JudgeMode =>
  spec.voicingMode === 'reference' ? 'strict' : step.slash ? 'bass' : 'loose';

/** 第 k 步的窗口什么时候关：下一步的窗口开始时（最后一步：弹满它的拍数） */
function windowEnd(state: RunState, k: number): number {
  const total = totalSteps(state.spec);
  if (total !== null && k === total - 1) return runEndT(state.spec, state.grid) as number;
  return scheduleStep(state.spec, state.grid, k + 1).windowStart;
}

function result(
  state: RunState,
  k: number,
  status: StepStatus,
  data: {
    attempt: ChordAttempt;
    judge: JudgeResult;
    source: InputSourceKind;
  } | null,
): StepResult {
  const s = scheduleStep(state.spec, state.grid, k);
  const base = {
    k,
    loop: s.loop,
    stepIndex: s.stepIndex,
    chordId: s.chordId,
    fromChordId: s.fromChordId,
    status,
    corrected: false,
  };
  if (!data) {
    return {
      ...base,
      notes: null,
      judge: null,
      onsetT: null,
      beatOffsetMs: null,
      onBeat: null,
      spreadMs: null,
      together: null,
      inputSource: 'manual',
    };
  }
  const { attempt, judge, source } = data;
  const onsetT = mean(attempt.newNotes.map((n) => attempt.onsets[n] as number)) as number;
  const beatOffsetMs = Math.round(onsetT - s.t - state.spec.latencyMs);
  const midi = source === 'midi';
  return {
    ...base,
    notes: attempt.notes,
    judge,
    onsetT,
    beatOffsetMs,
    onBeat: Math.abs(beatOffsetMs) <= onBeatToleranceMs(state.grid.beatMs),
    spreadMs: midi ? attempt.spreadMs : null,
    together: midi ? attempt.spreadMs <= state.spec.onsetWindowMs : null,
    inputSource: source,
  };
}

/** 把 open 之前（不含 upTo）还没有成绩的步定下来：只按了一部分 → 错，什么都没弹 → 漏弹 */
function closeUntil(state: RunState, upTo: number): RunState {
  let s = state;
  const total = totalSteps(s.spec);
  while (s.open < upTo && (total === null || s.open < total)) {
    const k = s.open;
    const r = s.partial ? result(s, k, 'wrong', s.partial) : result(s, k, 'missed', null);
    s = { ...s, results: [...s.results, r], open: k + 1, partial: null };
  }
  if (total !== null && s.open >= total) s = { ...s, finished: true };
  return s;
}

/** 这个时刻属于第几步的窗口 */
function stepAt(state: RunState, t: number): number {
  let k = Math.max(0, state.open - 1);
  while (windowEnd(state, k) <= t) k++;
  return k;
}

/**
 * 一次和弦尝试。属于哪一步按"新按下的音的平均按下时间"落在哪个窗口里决定。
 * - 这一步还没有成绩：弹对 → correct；只按了一部分（没多按、低音没错）→ 等补全；其他 → wrong；
 * - 已经判错的步里又弹对了 → corrected（成绩不变）；
 * - 跳到后面的步：中间没弹的步记为漏弹。
 */
export function runAttempt(
  state: RunState,
  attempt: ChordAttempt,
  source: InputSourceKind,
): RunState {
  if (state.finished || attempt.newNotes.length === 0) return state;
  const onsetT = mean(attempt.newNotes.map((n) => attempt.onsets[n] as number)) as number;
  const first = scheduleStep(state.spec, state.grid, 0);
  if (onsetT < first.windowStart) return state; // 预备拍里按的
  if (state.open > 0 && onsetT < scheduleStep(state.spec, state.grid, state.open - 1).windowStart) {
    return state; // 更早的步，早就有成绩了
  }
  const k = stepAt(state, onsetT);
  const total = totalSteps(state.spec);
  if (total !== null && k >= total) return closeUntil(state, total);

  if (k < state.open) {
    // 已经有成绩的步：判错之后改对了
    const idx = state.results.findIndex((r) => r.k === k);
    const prev = state.results[idx];
    if (prev?.status !== 'wrong' || prev.corrected) return state;
    const step = state.spec.steps[k % state.spec.steps.length] as RunStepSpec;
    const judge = judgeNotes(attempt.notes, step.target, judgeModeOf(state.spec, step));
    if (!judge.correct) return state;
    const results = [...state.results];
    results[idx] = { ...prev, corrected: true };
    return { ...state, results };
  }

  let s = closeUntil(state, k);
  if (s.finished) return s;
  const step = s.spec.steps[k % s.spec.steps.length] as RunStepSpec;
  const judge = judgeNotes(attempt.notes, step.target, judgeModeOf(s.spec, step));
  if (!judge.correct && judge.extra.length === 0 && !judge.wrongBass) {
    return { ...s, partial: { attempt, judge, source } };
  }
  const r = result(s, k, judge.correct ? 'correct' : 'wrong', { attempt, judge, source });
  s = { ...s, results: [...s.results, r], open: k + 1, partial: null };
  if (total !== null && s.open >= total) s = { ...s, finished: true };
  return s;
}

/** 时间推进：窗口已经关闭的步定下成绩（漏弹或只按了一部分） */
export function runTick(state: RunState, now: number): RunState {
  if (state.finished) return state;
  let upTo = state.open;
  while (windowEnd(state, upTo) <= now) upTo++;
  return upTo > state.open ? closeUntil(state, upTo) : state;
}

/** 手动结束：只保留已经定下成绩的步（正在弹的那一步不算） */
export function stopRun(state: RunState): RunState {
  return { ...state, finished: true, partial: null };
}

/** 一步"干净"：弹对、在拍上、音同时落下（非 MIDI 输入不看齐整度） */
export const stepClean = (r: StepResult) =>
  r.status === 'correct' && r.onBeat === true && r.together !== false;

/** 进行练习的显式证据（drillType 'progression'），一步产生和弦卡 + 切换卡两条 */
export interface RunEvidence {
  cardId: string;
  cardKind: 'chord' | 'transition';
  drillType: 'progression';
  correct: boolean;
  timedOut: boolean;
  extraNotes: number[];
  missingNotes: number[];
  spreadMs: number | null;
  together: boolean | null;
  beatOffsetMs: number | null;
  onBeat: boolean | null;
  hintUsed: boolean;
  inputSource: InputSourceKind;
}

export function stepEvidence(spec: RunSpec, r: StepResult): RunEvidence[] {
  const common = {
    drillType: 'progression' as const,
    correct: r.status === 'correct',
    timedOut: r.status === 'missed',
    extraNotes: r.judge?.extra ?? [],
    missingNotes: r.judge?.missing ?? [],
    spreadMs: r.spreadMs === null ? null : Math.round(r.spreadMs),
    together: r.together,
    beatOffsetMs: r.beatOffsetMs,
    onBeat: r.onBeat,
    hintUsed: spec.hintsVisible,
    inputSource: r.inputSource,
  };
  const out: RunEvidence[] = [
    {
      ...common,
      cardId: chordCardId(r.chordId, 'name', spec.voicingMode),
      cardKind: 'chord',
    },
  ];
  if (r.fromChordId !== null && r.fromChordId !== r.chordId) {
    out.push({
      ...common,
      cardId: transitionCardId(r.fromChordId, r.chordId, spec.voicingMode),
      cardKind: 'transition',
    });
  }
  return out;
}

/** 这条进行会产生证据的全部卡片 ID（和弦卡 + 循环里相邻和弦的切换卡） */
export function runCardIds(spec: RunSpec): string[] {
  const ids = new Set<string>();
  const n = spec.steps.length;
  spec.steps.forEach((step, i) => {
    ids.add(chordCardId(step.chordId, 'name', spec.voicingMode));
    const prev = spec.steps[(i - 1 + n) % n] as RunStepSpec;
    const loops = spec.loops === null || spec.loops > 1;
    if ((i > 0 || loops) && prev.chordId !== step.chordId) {
      ids.add(transitionCardId(prev.chordId, step.chordId, spec.voicingMode));
    }
  });
  return [...ids];
}

/**
 * 进行练习的评分：错或漏弹 Again；弹对且在拍上、同时落下 Good；
 * 不在拍上或没有同时落下 Hard；显示键位时最多 Hard。不给 Easy（节奏里没有可靠的"反应快"信号）。
 */
export function gradeRunEvidence(e: RunEvidence): Rating {
  if (!e.correct) return 1;
  if (e.onBeat === false || e.together === false || e.hintUsed) return 2;
  return 3;
}

export interface RunSummary {
  total: number;
  correct: number;
  missed: number;
  /** 弹对且在拍上、同时落下的比例（规格第 11 节的过关标准） */
  cleanRate: number;
  accuracy: number;
  /** 弹对的步里在拍上的比例 */
  onBeatRate: number | null;
  meanOffsetMs: number | null;
  /** 节拍偏差的标准差（稳定性） */
  stdevOffsetMs: number | null;
  meanSpreadMs: number | null;
  notTogether: number;
  offsets: number[];
  histogram: HistogramBin[];
  chords: { chordId: string; total: number; correct: number; meanOffsetMs: number | null }[];
  transitions: { from: string; to: string; total: number; correct: number; clean: number }[];
}

export function summarizeRun(results: readonly StepResult[]): RunSummary {
  const correct = results.filter((r) => r.status === 'correct');
  const offsets = correct.flatMap((r) => (r.beatOffsetMs === null ? [] : [r.beatOffsetMs]));
  const spreads = correct.flatMap((r) => (r.spreadMs === null ? [] : [r.spreadMs]));
  const chordMap = new Map<string, StepResult[]>();
  const transMap = new Map<string, StepResult[]>();
  for (const r of results) {
    chordMap.set(r.chordId, [...(chordMap.get(r.chordId) ?? []), r]);
    if (r.fromChordId && r.fromChordId !== r.chordId) {
      const key = `${r.fromChordId}>${r.chordId}`;
      transMap.set(key, [...(transMap.get(key) ?? []), r]);
    }
  }
  const total = results.length;
  const meanOrNull = (xs: number[]) => {
    const m = mean(xs);
    return m === null ? null : Math.round(m);
  };
  return {
    total,
    correct: correct.length,
    missed: results.filter((r) => r.status === 'missed').length,
    cleanRate: total === 0 ? 0 : results.filter(stepClean).length / total,
    accuracy: total === 0 ? 0 : correct.length / total,
    onBeatRate:
      correct.length === 0 ? null : correct.filter((r) => r.onBeat).length / correct.length,
    meanOffsetMs: meanOrNull(offsets),
    stdevOffsetMs: offsets.length < 2 ? null : Math.round(stdev(offsets) as number),
    meanSpreadMs: meanOrNull(spreads),
    notTogether: correct.filter((r) => r.together === false).length,
    offsets,
    histogram: histogram(offsets, { min: -200, max: 200, width: 20 }),
    chords: [...chordMap].map(([chordId, rs]) => {
      const ok = rs.filter((r) => r.status === 'correct');
      return {
        chordId,
        total: rs.length,
        correct: ok.length,
        meanOffsetMs: meanOrNull(
          ok.flatMap((r) => (r.beatOffsetMs === null ? [] : [r.beatOffsetMs])),
        ),
      };
    }),
    transitions: [...transMap].map(([key, rs]) => {
      const [from, to] = key.split('>') as [string, string];
      return {
        from,
        to,
        total: rs.length,
        correct: rs.filter((r) => r.status === 'correct').length,
        clean: rs.filter(stepClean).length,
      };
    }),
  };
}

/** 过关（规格第 11 节）：没有漏弹（不停顿），干净的步（对、在拍上、同时落下）比例达标 */
export function runPassed(summary: RunSummary, minClean: number): boolean {
  return summary.total > 0 && summary.missed === 0 && summary.cleanRate >= minClean;
}

/** 85% 规则调 BPM（规格 6.7）：看最近 window 步是否干净 */
export interface BpmParams {
  window: number;
  minSamples: number;
  high: number;
  low: number;
  up: number;
  down: number;
  min: number;
  max: number;
}

export const DEFAULT_BPM_PARAMS: BpmParams = {
  window: 20,
  minSamples: 10,
  high: 0.9,
  low: 0.75,
  up: 1.05,
  down: 0.9,
  min: 40,
  max: 200,
};

export function adaptBpm(
  bpm: number,
  recentClean: readonly boolean[],
  params: BpmParams = DEFAULT_BPM_PARAMS,
): { bpm: number; change: 'faster' | 'slower' | null } {
  const recent = recentClean.slice(-params.window);
  if (recent.length < params.minSamples) return { bpm, change: null };
  const rate = recent.filter(Boolean).length / recent.length;
  const clamp = (x: number) => Math.min(params.max, Math.max(params.min, Math.round(x)));
  if (rate > params.high) {
    const next = clamp(bpm * params.up);
    return next === bpm ? { bpm, change: null } : { bpm: next, change: 'faster' };
  }
  if (rate < params.low) {
    const next = clamp(bpm * params.down);
    return next === bpm ? { bpm, change: null } : { bpm: next, change: 'slower' };
  }
  return { bpm, change: null };
}
