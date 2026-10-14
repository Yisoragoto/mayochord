import { pitchClass } from '../theory/notes';

/**
 * XP（规格 6.8）：约 1 XP = 1 分钟专注的有效练习。
 * 每道题按"出题到完成"的时间计（单题最多 capMs，避免发呆的时间也算）；检测到乱按的题不计。
 */
export interface XpParams {
  capMs: number;
  /** 乱按：windowMs 内按下超过 maxInWindow 个音 */
  windowMs: number;
  maxInWindow: number;
  /** 乱按：一道题里按过超过 maxForeign 个不同的非目标音 */
  maxForeign: number;
}

export const DEFAULT_XP: XpParams = {
  capMs: 20_000,
  windowMs: 1000,
  maxInWindow: 10,
  maxForeign: 6,
};

export function trialXp(
  durationMs: number,
  mashing: boolean,
  params: XpParams = DEFAULT_XP,
): number {
  if (mashing || durationMs <= 0) return 0;
  return Math.min(durationMs, params.capMs) / 60_000;
}

/** 检测乱按：短时间内大量按键，或按了很多与题目无关的音。 */
export function detectMashing(
  noteOns: readonly { note: number; t: number }[],
  target: readonly number[],
  params: XpParams = DEFAULT_XP,
): boolean {
  const targetPcs = new Set(target.map(pitchClass));
  const foreign = new Set(
    noteOns.filter((e) => !targetPcs.has(pitchClass(e.note))).map((e) => e.note),
  );
  if (foreign.size > params.maxForeign) return true;
  const times = noteOns.map((e) => e.t).sort((a, b) => a - b);
  let lo = 0;
  for (let hi = 0; hi < times.length; hi++) {
    while ((times[hi] as number) - (times[lo] as number) > params.windowMs) lo++;
    if (hi - lo + 1 > params.maxInWindow) return true;
  }
  return false;
}

/** 每个练习日的 XP：Map<dayKey, xp> */
export function xpByDay(
  entries: readonly { ts: number; xp?: number }[],
  dayOf: (ts: number) => string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) {
    if (!e.xp) continue;
    const d = dayOf(e.ts);
    out.set(d, (out.get(d) ?? 0) + e.xp);
  }
  return out;
}

const shiftDay = (day: string, delta: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);

/**
 * 连续练习天数：从今天（今天还没练则从昨天）往前数，每天 XP ≥ minXp。
 */
export function currentStreak(xp: ReadonlyMap<string, number>, today: string, minXp = 1): number {
  const ok = (d: string) => (xp.get(d) ?? 0) >= minXp;
  let day = ok(today) ? today : shiftDay(today, -1);
  let n = 0;
  while (ok(day)) {
    n++;
    day = shiftDay(day, -1);
  }
  return n;
}

/** 最近 n 天（含今天）每天的 XP，旧 → 新 */
export function lastDays(xp: ReadonlyMap<string, number>, today: string, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const day = shiftDay(today, i - n + 1);
    return { day, xp: xp.get(day) ?? 0 };
  });
}
