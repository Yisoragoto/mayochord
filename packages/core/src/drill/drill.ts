import type { InputEvent } from '../input/events';
import type { CardKind } from '../log/review-log';
import type { AttemptOptions } from '../recognition/attempt';
import type { JudgeMode } from '../recognition/judge';
import type {
  AnyCard,
  ChordCard,
  Cue,
  IntervalCard,
  NoteCard,
  TransitionCard,
  VoicingMode,
} from './cards';
import { intervalCardTarget, noteCardTarget } from './targets';
import {
  type DrillType,
  evaluateTrial,
  type Trial,
  type TrialOutcome,
  type TrialState,
} from './trial';

/** 出题需要的上下文：键位来源、时限等由调用方（练习会话）提供。 */
export interface DrillContext {
  /** 和弦 ID → 参考键位的 MIDI 号 */
  referenceNotes(chordId: string): readonly number[];
  /** 和弦是不是斜杠和弦（宽松判定时也要求最低音正确） */
  hasBass?(chordId: string): boolean;
  timeLimitMs: number;
  onsetWindowMs: number;
  hintAtStart: boolean;
  /** 生成题目 ID */
  trialId: string;
}

/** 一条显式证据：写入作答日志前还要由调度策略评分（rating）。 */
export interface Evidence extends TrialOutcome {
  cardId: string;
  cardKind: CardKind;
  drillType: DrillType;
}

/**
 * 练习类型接口（规格 4.2-4）。新的练习类型实现这个接口并注册，不需要改调度器。
 * 判定流程统一由 trial.ts 的 stepTrial 驱动；evaluate 是重放用的纯函数。
 */
export interface Drill<C extends AnyCard = AnyCard> {
  type: DrillType;
  /** 这个练习能用哪种卡片 */
  accepts(card: AnyCard): card is C;
  createTrial(card: C, ctx: DrillContext): Trial;
  evaluate(
    trial: Trial,
    startT: number,
    events: readonly InputEvent[],
    opts?: Partial<AttemptOptions>,
    endT?: number,
  ): TrialState;
  toEvidence(trial: Trial, outcome: TrialOutcome): Evidence[];
}

export const judgeModeFor = (mode: VoicingMode, slash = false): JudgeMode =>
  mode === 'reference' ? 'strict' : slash ? 'bass' : 'loose';

/** 和弦卡的题面 → 练习类型（反应时间的个人中位数、85% 时限按练习类型分开） */
export const CHORD_CUE_DRILL: Record<Cue, DrillType> = {
  name: 'name-to-chord',
  spelled: 'build-chord',
  audio: 'ear-to-chord',
  staff: 'staff-to-chord',
  roman: 'roman-to-chord',
};

/**
 * 看题面弹和弦：看和弦名、文字名称（12 调构建）、听声音、看五线谱、看级数，弹出这个和弦。
 * 判定都一样（宽松 / 严格 / 斜杠和弦看低音），只是题面不同。
 */
function chordCueDrill(cue: Cue): Drill<ChordCard> {
  const type = CHORD_CUE_DRILL[cue];
  return {
    type,
    accepts: (card): card is ChordCard => card.kind === 'chord' && card.cue === cue,
    createTrial(card, ctx) {
      return {
        id: ctx.trialId,
        drillType: type,
        card,
        targetChordId: card.chordId,
        target: [...ctx.referenceNotes(card.chordId)],
        fromChordId: null,
        from: null,
        mode: judgeModeFor(card.voicingMode, ctx.hasBass?.(card.chordId) ?? false),
        timeLimitMs: ctx.timeLimitMs,
        onsetWindowMs: ctx.onsetWindowMs,
        hintAtStart: ctx.hintAtStart,
      };
    },
    evaluate: evaluateTrial,
    toEvidence(trial, outcome) {
      return [{ ...outcome, cardId: trial.card.id, cardKind: 'chord', drillType: type }];
    },
  };
}

/** 看名弹和弦：显示和弦名，弹出这个和弦。 */
export const nameToChordDrill = chordCueDrill('name');
/** 12 调构建：显示文字名称（"E♭ 小三和弦"），任意转位都算对（规格 10） */
export const buildChordDrill = chordCueDrill('spelled');
/** 听辨 / 对比配对 / 听音挑战：听声音，答出或弹出这个和弦 */
export const earToChordDrill = chordCueDrill('audio');
/** 五线谱提示：看大谱表上的和弦弹出来 */
export const staffToChordDrill = chordCueDrill('staff');
/** 看级数弹和弦：例如 C 调的 VIm → Am */
export const romanToChordDrill = chordCueDrill('roman');

/**
 * 和弦切换：先弹"从"和弦（不计分），弹稳后立刻显示目标，测量从"从"和弦弹稳到目标和弦弹出的时间。
 * 只记录切换卡的证据（反应条件与看名弹和弦不同，不混进和弦卡的反应时间）。
 */
export const transitionDrill: Drill<TransitionCard> = {
  type: 'transition',
  accepts: (card): card is TransitionCard => card.kind === 'transition',
  createTrial(card, ctx) {
    return {
      id: ctx.trialId,
      drillType: 'transition',
      card,
      targetChordId: card.toChordId,
      target: [...ctx.referenceNotes(card.toChordId)],
      fromChordId: card.fromChordId,
      from: [...ctx.referenceNotes(card.fromChordId)],
      mode: judgeModeFor(card.voicingMode, ctx.hasBass?.(card.toChordId) ?? false),
      timeLimitMs: ctx.timeLimitMs,
      onsetWindowMs: ctx.onsetWindowMs,
      hintAtStart: ctx.hintAtStart,
    };
  },
  evaluate: evaluateTrial,
  toEvidence(trial, outcome) {
    return [{ ...outcome, cardId: trial.card.id, cardKind: 'transition', drillType: 'transition' }];
  },
};

/** 认音名：显示音名，弹出任意八度的这个音。 */
export const nameToNoteDrill: Drill<NoteCard> = {
  type: 'name-to-note',
  accepts: (card): card is NoteCard => card.kind === 'note',
  createTrial(card, ctx) {
    return {
      id: ctx.trialId,
      drillType: 'name-to-note',
      card,
      targetChordId: card.id,
      target: noteCardTarget(card).map((n) => n.midi),
      fromChordId: null,
      from: null,
      mode: 'loose',
      timeLimitMs: ctx.timeLimitMs,
      onsetWindowMs: ctx.onsetWindowMs,
      hintAtStart: ctx.hintAtStart,
    };
  },
  evaluate: evaluateTrial,
  toEvidence(trial, outcome) {
    return [{ ...outcome, cardId: trial.card.id, cardKind: 'note', drillType: 'name-to-note' }];
  },
};

/** 音程：从根音向上弹出音程（两个音一起按下，最低音必须是根音）。 */
export const intervalDrill: Drill<IntervalCard> = {
  type: 'interval',
  accepts: (card): card is IntervalCard => card.kind === 'interval',
  createTrial(card, ctx) {
    return {
      id: ctx.trialId,
      drillType: 'interval',
      card,
      targetChordId: card.id,
      target: intervalCardTarget(card).map((n) => n.midi),
      fromChordId: null,
      from: null,
      mode: 'bass',
      timeLimitMs: ctx.timeLimitMs,
      onsetWindowMs: ctx.onsetWindowMs,
      hintAtStart: ctx.hintAtStart,
    };
  },
  evaluate: evaluateTrial,
  toEvidence(trial, outcome) {
    return [{ ...outcome, cardId: trial.card.id, cardKind: 'interval', drillType: 'interval' }];
  },
};

const registry = new Map<DrillType, Drill>();

/** 注册练习类型。 */
export function registerDrill(
  drill:
    | Drill<AnyCard>
    | Drill<ChordCard>
    | Drill<TransitionCard>
    | Drill<NoteCard>
    | Drill<IntervalCard>,
) {
  registry.set(drill.type, drill as Drill);
}

export function getDrill(type: DrillType): Drill {
  const d = registry.get(type);
  if (!d) throw new Error(`Unknown drill type: ${type}`);
  return d;
}

/** 能处理这张卡片的练习类型 */
export function drillForCard(card: AnyCard): Drill {
  for (const d of registry.values()) if (d.accepts(card)) return d;
  throw new Error(`No drill accepts card ${card.id}`);
}

registerDrill(nameToChordDrill);
registerDrill(buildChordDrill);
registerDrill(earToChordDrill);
registerDrill(staffToChordDrill);
registerDrill(romanToChordDrill);
registerDrill(transitionDrill);
registerDrill(nameToNoteDrill);
registerDrill(intervalDrill);
