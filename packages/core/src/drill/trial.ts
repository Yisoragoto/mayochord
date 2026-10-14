import type { InputEvent } from '../input/events';
import { sourceKind } from '../input/source-kind';
import type { InputSourceKind } from '../log/review-log';
import { type AttemptOptions, AttemptTracker, type ChordAttempt } from '../recognition/attempt';
import {
  findUniformShift,
  type JudgeMode,
  type JudgeResult,
  judgeNotes,
} from '../recognition/judge';
import { pitchClass } from '../theory/notes';
import type { AnyCard } from './cards';

/**
 * 一道题的通用流程（"看名弹和弦"和"和弦切换"共用）：
 *
 * - setup（只有切换题）：先弹出"从"和弦，不计分。弹稳后进入 awaiting，并从这一刻开始计时。
 * - awaiting：等用户弹目标和弦。第一次判定决定这道题的成绩：
 *   - 弹对 → done；
 *   - 弹错（有多按的音，或少按且多按）→ retry，显示键位提示；
 *   - 只按了目标的一部分（没有多按）→ 视为还没弹完，继续等；
 *   - 整体平移（OCTAVE/TRANSPOSE 被改动）→ 不计成绩，提示重新校准，继续等；
 *   - 超时 → retry，显示键位提示。
 * - retry：提示可见，弹对后 done（不再改变成绩）。用户也可以跳过。
 *
 * 全部是纯函数：网页用实时的和弦尝试驱动 stepTrial，测试用 evaluateTrial 重放事件。
 */
export type DrillType = 'name-to-chord' | 'transition' | 'name-to-note' | 'interval';

export interface Trial {
  id: string;
  drillType: DrillType;
  card: AnyCard;
  targetChordId: string;
  /** 目标键位（参考键位的 MIDI 号，升序） */
  target: readonly number[];
  /** 切换题的"从"和弦键位；看名弹和弦为 null */
  fromChordId: string | null;
  from: readonly number[] | null;
  mode: JudgeMode;
  /** 从提示出现到必须弹出的时限（毫秒） */
  timeLimitMs: number;
  /** 齐整度窗口（毫秒），超过视为"没有同时落下" */
  onsetWindowMs: number;
  /** 一开始就显示键位（例如第一次见到的新卡），会记为使用了提示 */
  hintAtStart: boolean;
}

export type TrialStatus = 'setup' | 'awaiting' | 'retry' | 'done';

export interface TrialOutcome {
  correct: boolean;
  timedOut: boolean;
  /** 从提示出现到最后一个音按下（毫秒）；超时为 null */
  reactionMs: number | null;
  extraNotes: number[];
  missingNotes: number[];
  /** 齐整度：这次新按下的音的最大时间差。只对 MIDI 输入有意义，其他输入源为 null */
  spreadMs: number | null;
  together: boolean | null;
  hintUsed: boolean;
  inputSource: InputSourceKind;
}

export interface AttemptFeedback {
  stage: 'from' | 'target';
  attempt: ChordAttempt;
  judge: JudgeResult;
  /** 整体平移的半音数（OCTAVE/TRANSPOSE 被改动的迹象） */
  shift: number | null;
}

export interface TrialState {
  trial: Trial;
  status: TrialStatus;
  startT: number;
  /** 目标提示出现、开始计时的时刻（切换题为"从"和弦弹稳的时刻） */
  cueT: number | null;
  /** 目标键位提示是否可见 */
  hintVisible: boolean;
  hintUsed: boolean;
  /** "从"和弦的键位提示（切换题弹错"从"和弦后显示） */
  setupHintVisible: boolean;
  /** 第一次判定的成绩；跳过 setup 的题为 null */
  outcome: TrialOutcome | null;
  /** 最近一次被判定的尝试，用于界面反馈 */
  feedback: AttemptFeedback | null;
  doneAt: number | null;
}

export type TrialEvent =
  | { type: 'attempt'; attempt: ChordAttempt }
  | { type: 'tick'; now: number }
  | { type: 'hint'; now: number }
  | { type: 'skip'; now: number };

function samePitchClasses(a: readonly number[], b: readonly number[]): boolean {
  const pa = new Set(a.map(pitchClass));
  const pb = new Set(b.map(pitchClass));
  return pa.size === pb.size && [...pa].every((p) => pb.has(p));
}

function sameNotes(a: readonly number[], b: readonly number[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((n) => sb.has(n));
}

/** 开始一道题。heldAtStart = 出题时已经按住的音（切换题可以直接沿用正按着的"从"和弦）。 */
export function startTrial(
  trial: Trial,
  startT: number,
  heldAtStart: readonly number[],
): TrialState {
  const base: TrialState = {
    trial,
    status: 'awaiting',
    startT,
    cueT: startT,
    hintVisible: trial.hintAtStart,
    hintUsed: trial.hintAtStart,
    setupHintVisible: trial.hintAtStart,
    outcome: null,
    feedback: null,
    doneAt: null,
  };
  if (trial.from === null) return base;
  const holdingFrom =
    heldAtStart.length > 0 && judgeNotes(heldAtStart, trial.from, trial.mode).correct;
  return holdingFrom ? base : { ...base, status: 'setup', cueT: null };
}

/** 这次作答中"新按下的音"：提示出现之后按下的（从上一个和弦保持下来的共同音不算）。 */
function answerNotes(attempt: ChordAttempt, cueT: number): number[] {
  const fresh = attempt.notes.filter((n) => (attempt.onsets[n] ?? -Infinity) >= cueT);
  return fresh.length > 0 ? fresh : attempt.newNotes;
}

function inputKind(attempt: ChordAttempt, notes: readonly number[]): InputSourceKind {
  const kinds = notes.map((n) => sourceKind(attempt.sources[n] ?? ''));
  return kinds.find((k) => k !== 'midi') ?? 'midi';
}

function outcomeFor(state: TrialState, attempt: ChordAttempt, judge: JudgeResult): TrialOutcome {
  const cueT = state.cueT ?? state.startT;
  const notes = answerNotes(attempt, cueT);
  const times = notes.map((n) => attempt.onsets[n] as number);
  const first = Math.min(...times);
  const last = Math.max(...times);
  const inputSource = inputKind(attempt, notes);
  const spreadMs = inputSource === 'midi' ? last - first : null;
  return {
    correct: judge.correct,
    timedOut: false,
    reactionMs: Math.max(0, last - cueT),
    extraNotes: judge.extra,
    missingNotes: judge.missing,
    spreadMs,
    together: spreadMs === null ? null : spreadMs <= state.trial.onsetWindowMs,
    hintUsed: state.hintUsed,
    inputSource,
  };
}

function timeoutOutcome(state: TrialState): TrialOutcome {
  return {
    correct: false,
    timedOut: true,
    reactionMs: null,
    extraNotes: [],
    missingNotes: [],
    spreadMs: null,
    together: null,
    hintUsed: state.hintUsed,
    inputSource: state.feedback
      ? inputKind(state.feedback.attempt, state.feedback.attempt.notes)
      : 'manual',
  };
}

function applyTick(state: TrialState, now: number): TrialState {
  if (state.status !== 'awaiting' || state.cueT === null) return state;
  if (now - state.cueT < state.trial.timeLimitMs) return state;
  return {
    ...state,
    status: 'retry',
    hintVisible: true,
    outcome: timeoutOutcome(state),
  };
}

function applyAttempt(state: TrialState, attempt: ChordAttempt): TrialState {
  const { trial } = state;
  if (state.status === 'done') return state;

  if (state.status === 'setup') {
    const from = trial.from as readonly number[];
    const judge = judgeNotes(attempt.notes, from, trial.mode);
    const feedback: AttemptFeedback = {
      stage: 'from',
      attempt,
      judge,
      shift: judge.correct ? null : findUniformShift(attempt.notes, from),
    };
    if (!judge.correct) return { ...state, feedback, setupHintVisible: true };
    return { ...state, status: 'awaiting', cueT: attempt.stableAt, feedback };
  }

  // 超时发生在这次尝试之前：先按超时处理
  const ticked = applyTick(state, attempt.stableAt);
  if (ticked !== state) return applyAttempt(ticked, attempt);

  // 切换题里重新按了一遍"从"和弦：不算作答
  if (trial.from !== null) {
    const same = trial.mode === 'strict' ? sameNotes : samePitchClasses;
    if (same(attempt.notes, trial.from) && !same(trial.from, trial.target)) return state;
  }

  const judge = judgeNotes(attempt.notes, trial.target, trial.mode);
  const shift = judge.correct ? null : findUniformShift(attempt.notes, trial.target);
  const feedback: AttemptFeedback = { stage: 'target', attempt, judge, shift };

  if (state.status === 'retry') {
    return judge.correct
      ? { ...state, status: 'done', feedback, doneAt: attempt.stableAt }
      : { ...state, feedback };
  }

  // awaiting：第一次判定
  if (judge.correct) {
    return {
      ...state,
      status: 'done',
      feedback,
      outcome: outcomeFor(state, attempt, judge),
      doneAt: attempt.stableAt,
    };
  }
  // 整体平移：设备设置问题，不计成绩
  if (shift !== null) return { ...state, feedback };
  // 只按了一部分：还没弹完（低音不对的不算）
  if (judge.extra.length === 0 && !judge.wrongBass) return state;
  return {
    ...state,
    status: 'retry',
    hintVisible: true,
    feedback,
    outcome: outcomeFor(state, attempt, judge),
  };
}

export function stepTrial(state: TrialState, event: TrialEvent): TrialState {
  switch (event.type) {
    case 'attempt':
      return applyAttempt(state, event.attempt);
    case 'tick':
      return applyTick(state, event.now);
    case 'hint':
      if (state.status === 'setup') return { ...state, setupHintVisible: true };
      if (state.status === 'awaiting') return { ...state, hintVisible: true, hintUsed: true };
      return state;
    case 'skip': {
      if (state.status === 'done') return state;
      const outcome = state.status === 'awaiting' ? timeoutOutcome(state) : state.outcome;
      return { ...state, status: 'done', outcome, doneAt: event.now };
    }
  }
}

/** 距离超时还有多久（毫秒）；不在计时状态时为 null。 */
export function msUntilTimeout(state: TrialState, now: number): number | null {
  if (state.status !== 'awaiting' || state.cueT === null) return null;
  return Math.max(0, state.cueT + state.trial.timeLimitMs - now);
}

/**
 * 纯函数版本：用一串输入事件重放一道题。startT 之前的事件只用来确定出题时按住的音。
 * endT 用于最后检查稳定与超时。
 */
export function evaluateTrial(
  trial: Trial,
  startT: number,
  events: readonly InputEvent[],
  attemptOptions: Partial<AttemptOptions> = {},
  endT?: number,
): TrialState {
  const tracker = new AttemptTracker({
    ...attemptOptions,
    onsetWindowMs: trial.onsetWindowMs,
  });
  let i = 0;
  for (; i < events.length && (events[i] as InputEvent).t < startT; i++) {
    tracker.push(events[i] as InputEvent);
  }
  tracker.poll(startT);
  let state = startTrial(trial, startT, tracker.heldNotes());
  for (; i < events.length; i++) {
    const e = events[i] as InputEvent;
    const a = tracker.push(e);
    if (a) state = stepTrial(state, { type: 'attempt', attempt: a });
    state = stepTrial(state, { type: 'tick', now: e.t });
  }
  if (endT !== undefined) {
    const a = tracker.poll(endT);
    if (a) state = stepTrial(state, { type: 'attempt', attempt: a });
    state = stepTrial(state, { type: 'tick', now: endT });
  }
  return state;
}
