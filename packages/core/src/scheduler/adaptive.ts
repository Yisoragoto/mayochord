/**
 * 85% 规则（规格 6.7，Wilson 等 2019）：根据最近 window 题的正确率调整时限，目标约 85%。
 * 正确率高于 high → 收紧（时限 × tightenFactor）；低于 low → 放宽（× loosenFactor）。
 * 每次调整后至少再做 cooldown 题才会再次调整，避免来回抖动。
 */
export interface AdaptiveParams {
  window: number;
  minSamples: number;
  high: number;
  low: number;
  tightenFactor: number;
  loosenFactor: number;
  cooldown: number;
  minMs: number;
  maxMs: number;
}

export interface AdaptiveState {
  timeLimitMs: number;
  /** 上次调整之后又做了多少题 */
  sinceAdjust: number;
}

export type AdaptiveChange = 'tighten' | 'loosen' | null;

const BASE = {
  window: 20,
  minSamples: 10,
  high: 0.9,
  low: 0.75,
  tightenFactor: 0.85,
  loosenFactor: 1.2,
  cooldown: 5,
} as const;

/** 各练习类型的默认参数与初始时限 */
export const DEFAULT_ADAPTIVE: Record<
  'name-to-chord' | 'transition',
  { params: AdaptiveParams; initialMs: number }
> = {
  'name-to-chord': { params: { ...BASE, minMs: 1500, maxMs: 15000 }, initialMs: 6000 },
  transition: { params: { ...BASE, minMs: 1000, maxMs: 12000 }, initialMs: 5000 },
};

export function initialAdaptiveState(initialMs: number): AdaptiveState {
  return { timeLimitMs: initialMs, sinceAdjust: 0 };
}

/**
 * 做完一题后调用。recent = 最近若干题是否正确（时间升序，包含刚做完的这题）。
 */
export function adaptTimeLimit(
  state: AdaptiveState,
  recent: readonly boolean[],
  params: AdaptiveParams,
): { state: AdaptiveState; change: AdaptiveChange } {
  const sinceAdjust = state.sinceAdjust + 1;
  const window = recent.slice(-params.window);
  if (window.length < params.minSamples || sinceAdjust < params.cooldown) {
    return { state: { ...state, sinceAdjust }, change: null };
  }
  const accuracy = window.filter(Boolean).length / window.length;
  const clamp = (ms: number) => Math.round(Math.min(params.maxMs, Math.max(params.minMs, ms)));
  let change: AdaptiveChange = null;
  let timeLimitMs = state.timeLimitMs;
  if (accuracy > params.high) {
    timeLimitMs = clamp(state.timeLimitMs * params.tightenFactor);
    change = 'tighten';
  } else if (accuracy < params.low) {
    timeLimitMs = clamp(state.timeLimitMs * params.loosenFactor);
    change = 'loosen';
  }
  if (timeLimitMs === state.timeLimitMs) return { state: { ...state, sinceAdjust }, change: null };
  return { state: { timeLimitMs, sinceAdjust: 0 }, change };
}
