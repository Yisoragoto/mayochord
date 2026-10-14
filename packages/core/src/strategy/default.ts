import type { GradeInput } from '../grading/grade';
import { DEFAULT_GRADING, type GradingParams, gradeEvidence } from '../grading/grade';
import type { Rating, ReviewLog } from '../log/review-log';
import { type AdaptiveParams, DEFAULT_ADAPTIVE } from '../scheduler/adaptive';
import {
  applyLog,
  type CardProgress,
  DEFAULT_PROGRESS,
  type ProgressParams,
} from '../scheduler/progress';
import { DEFAULT_SESSION, type SessionParams } from '../scheduler/session';

/**
 * 调度策略（规格 4.2-7）：评分、进度更新、练习内出题、自适应难度的参数与规则集中在这里，
 * 可以整体替换。界面和存储只通过这个对象调用。
 */
export interface SchedulingStrategy {
  readonly grading: GradingParams;
  readonly progress: ProgressParams;
  readonly session: SessionParams;
  readonly adaptive: Record<
    'name-to-chord' | 'transition',
    { params: AdaptiveParams; initialMs: number }
  >;
  grade(e: GradeInput, personalMedianMs: number | null): Rating;
  applyLog(p: CardProgress, log: ReviewLog): CardProgress;
  /** 出题时是否一开始就显示键位（第一次见到的卡先示范一次） */
  hintAtStart(p: CardProgress): boolean;
}

export interface StrategyOverrides {
  grading?: Partial<GradingParams>;
  progress?: Partial<ProgressParams>;
  session?: Partial<SessionParams>;
}

export function createDefaultStrategy(overrides: StrategyOverrides = {}): SchedulingStrategy {
  const grading = { ...DEFAULT_GRADING, ...overrides.grading };
  const progress = { ...DEFAULT_PROGRESS, ...overrides.progress };
  const session = { ...DEFAULT_SESSION, ...overrides.session };
  return {
    grading,
    progress,
    session,
    adaptive: DEFAULT_ADAPTIVE,
    grade: (e, m) => gradeEvidence(e, m, grading),
    applyLog: (p, log) => applyLog(p, log, progress),
    hintAtStart: (p) => p.attempts === 0,
  };
}
