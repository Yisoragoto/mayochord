import type { InputEvent } from '../input/events';
import type { CardKind } from '../log/review-log';
import type { AttemptOptions } from '../recognition/attempt';
import type { JudgeMode } from '../recognition/judge';
import type { AnyCard, ChordCard, TransitionCard, VoicingMode } from './cards';
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

export const judgeModeFor = (mode: VoicingMode): JudgeMode =>
  mode === 'reference' ? 'strict' : 'loose';

/** 看名弹和弦：显示和弦名，弹出这个和弦。 */
export const nameToChordDrill: Drill<ChordCard> = {
  type: 'name-to-chord',
  accepts: (card): card is ChordCard => card.kind === 'chord',
  createTrial(card, ctx) {
    return {
      id: ctx.trialId,
      drillType: 'name-to-chord',
      card,
      targetChordId: card.chordId,
      target: [...ctx.referenceNotes(card.chordId)],
      fromChordId: null,
      from: null,
      mode: judgeModeFor(card.voicingMode),
      timeLimitMs: ctx.timeLimitMs,
      onsetWindowMs: ctx.onsetWindowMs,
      hintAtStart: ctx.hintAtStart,
    };
  },
  evaluate: evaluateTrial,
  toEvidence(trial, outcome) {
    return [{ ...outcome, cardId: trial.card.id, cardKind: 'chord', drillType: 'name-to-chord' }];
  },
};

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
      mode: judgeModeFor(card.voicingMode),
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

const registry = new Map<DrillType, Drill>();

/** 注册练习类型。 */
export function registerDrill(drill: Drill<AnyCard> | Drill<ChordCard> | Drill<TransitionCard>) {
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
registerDrill(transitionDrill);
