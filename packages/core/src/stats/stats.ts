import { median } from '../grading/grade';
import type { ReviewLog } from '../log/review-log';
import { mean, stdev } from '../timing/stats';

/**
 * 统计页（规格 10-7）用的纯函数：都只读作答日志（显式证据），按练习日分组。
 */
const explicit = (l: ReviewLog) => l.evidence === 'explicit';

/** 和弦卡 ID → 和弦 ID（chord:<chordId>:...） */
export const chordIdOfCard = (cardId: string) =>
  cardId.startsWith('chord:') ? (cardId.split(':')[1] ?? null) : null;

/** 切换卡 ID → [从, 到]（transition:<from>><to>:mode） */
export function transitionOfCard(cardId: string): [string, string] | null {
  if (!cardId.startsWith('transition:')) return null;
  const [from, to] = (cardId.split(':')[1] ?? '').split('>');
  return from && to ? [from, to] : null;
}

export interface TrendPoint {
  day: string;
  /** 这一天正确作答的反应时间中位数（毫秒） */
  medianMs: number;
  count: number;
}

export interface ChordTrend {
  chordId: string;
  /** 一共有多少条反应时间 */
  total: number;
  points: TrendPoint[];
}

/**
 * 每个和弦的反应时间随天数变化（看名弹和弦这类"看题面弹和弦"的练习；切换、跟拍不算）。
 * 只取正确、没看提示的作答；按作答次数从多到少取前 limit 个和弦。
 */
export function reactionTrends(
  logs: readonly ReviewLog[],
  dayOf: (ts: number) => string,
  opts: { drillTypes?: readonly string[]; limit?: number } = {},
): ChordTrend[] {
  const types = new Set(opts.drillTypes ?? ['name-to-chord']);
  const byChord = new Map<string, Map<string, number[]>>();
  for (const l of logs) {
    if (!explicit(l) || !types.has(l.drillType) || !l.correct || l.hintUsed) continue;
    if (l.reactionMs === null) continue;
    const chordId = chordIdOfCard(l.cardId);
    if (!chordId) continue;
    const days = byChord.get(chordId) ?? new Map<string, number[]>();
    const day = dayOf(l.ts);
    days.set(day, [...(days.get(day) ?? []), l.reactionMs]);
    byChord.set(chordId, days);
  }
  return [...byChord]
    .map(([chordId, days]) => {
      const points = [...days]
        .map(([day, xs]) => ({ day, medianMs: Math.round(median(xs) as number), count: xs.length }))
        .sort((a, b) => a.day.localeCompare(b.day));
      return { chordId, total: points.reduce((s, p) => s + p.count, 0), points };
    })
    .sort((a, b) => b.total - a.total || a.chordId.localeCompare(b.chordId))
    .slice(0, opts.limit ?? 8);
}

export interface HeatCell {
  from: string;
  to: string;
  /** 正确切换的平均用时（毫秒）；没有正确的为 null */
  meanMs: number | null;
  count: number;
  accuracy: number;
}

/** 和弦切换热力图（横轴"从"、纵轴"到"）：切换练习里每个切换的平均用时与正确率 */
export function transitionHeatmap(
  logs: readonly ReviewLog[],
  since = 0,
): { chords: string[]; cells: HeatCell[] } {
  const map = new Map<string, { times: number[]; total: number; correct: number }>();
  const order: string[] = [];
  const see = (id: string) => {
    if (!order.includes(id)) order.push(id);
  };
  for (const l of logs) {
    if (!explicit(l) || l.drillType !== 'transition' || l.ts < since) continue;
    const pair = transitionOfCard(l.cardId);
    if (!pair) continue;
    see(pair[0]);
    see(pair[1]);
    const key = `${pair[0]}>${pair[1]}`;
    const cell = map.get(key) ?? { times: [], total: 0, correct: 0 };
    cell.total++;
    if (l.correct) {
      cell.correct++;
      if (l.reactionMs !== null) cell.times.push(l.reactionMs);
    }
    map.set(key, cell);
  }
  const cells = [...map].map(([key, c]) => {
    const [from, to] = key.split('>') as [string, string];
    const m = mean(c.times);
    return {
      from,
      to,
      meanMs: m === null ? null : Math.round(m),
      count: c.total,
      accuracy: c.correct / c.total,
    };
  });
  return { chords: order, cells };
}

export interface BeatOffsetDay {
  day: string;
  count: number;
  meanMs: number;
  stdevMs: number;
}

/** 跟拍练习的节拍偏差：全部偏差（画分布）与每天的平均和标准差（看稳定性的变化） */
export function beatOffsetStats(
  logs: readonly ReviewLog[],
  dayOf: (ts: number) => string,
): { offsets: number[]; days: BeatOffsetDay[] } {
  const offsets: number[] = [];
  const byDay = new Map<string, number[]>();
  for (const l of logs) {
    // 一步有和弦卡、切换卡两条证据，只取和弦卡那条
    if (!explicit(l) || l.drillType !== 'progression' || l.cardKind !== 'chord') continue;
    if (!l.correct || l.beatOffsetMs === null) continue;
    offsets.push(l.beatOffsetMs);
    const day = dayOf(l.ts);
    byDay.set(day, [...(byDay.get(day) ?? []), l.beatOffsetMs]);
  }
  const days = [...byDay]
    .map(([day, xs]) => ({
      day,
      count: xs.length,
      meanMs: Math.round(mean(xs) as number),
      stdevMs: Math.round(stdev(xs) as number),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
  return { offsets, days };
}

/** 一段时间内的总体：作答次数、正确率、练习天数 */
export function practiceTotals(logs: readonly ReviewLog[], dayOf: (ts: number) => string) {
  const ex = logs.filter((l) => explicit(l) && l.cardKind !== 'topic');
  const days = new Set(ex.map((l) => dayOf(l.ts)));
  return {
    answers: ex.length,
    accuracy: ex.length === 0 ? null : ex.filter((l) => l.correct).length / ex.length,
    days: days.size,
  };
}
