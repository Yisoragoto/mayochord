import { describe, expect, it } from 'vitest';
import type { ReviewLog } from '../log/review-log';
import {
  beatOffsetStats,
  chordIdOfCard,
  practiceTotals,
  reactionTrends,
  transitionHeatmap,
  transitionOfCard,
} from './stats';

const DAY = 86_400_000;
const dayOf = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const T = Date.UTC(2026, 9, 10, 12);
let n = 0;
const log = (over: Partial<ReviewLog>): ReviewLog => ({
  id: `l${n++}`,
  ts: T,
  sessionId: null,
  cardId: 'chord:c:name:any',
  cardKind: 'chord',
  drillType: 'name-to-chord',
  evidence: 'explicit',
  weight: 1,
  correct: true,
  reactionMs: 1000,
  extraNotes: [],
  missingNotes: [],
  spreadMs: null,
  beatOffsetMs: null,
  hintUsed: false,
  rating: 3,
  inputSource: 'midi',
  contentVersion: '1',
  ...over,
});

describe('统计', () => {
  it('卡片 ID 解析', () => {
    expect(chordIdOfCard('chord:am7:audio@C:any')).toBe('am7');
    expect(chordIdOfCard('note:c')).toBeNull();
    expect(transitionOfCard('transition:c>g:reference')).toEqual(['c', 'g']);
    expect(transitionOfCard('transition:bad:any')).toBeNull();
    expect(transitionOfCard('chord:c:name:any')).toBeNull();
  });

  it('反应时间趋势：每天的中位数；不算错的、看了提示的、隐式的；按次数排序', () => {
    const logs = [
      log({ reactionMs: 1200 }),
      log({ reactionMs: 800 }),
      log({ reactionMs: 1000 }),
      log({ ts: T + DAY, reactionMs: 700 }),
      log({ correct: false, reactionMs: 300 }),
      log({ hintUsed: true, reactionMs: 300 }),
      log({ evidence: 'implicit', reactionMs: 300 }),
      log({ reactionMs: null }),
      log({ cardId: 'chord:g:name:any', reactionMs: 900 }),
      log({ cardId: 'transition:c>g:any', drillType: 'transition' }),
    ];
    const trends = reactionTrends(logs, dayOf);
    expect(trends.map((t) => t.chordId)).toEqual(['c', 'g']);
    expect(trends[0]?.points).toEqual([
      { day: '2026-10-10', medianMs: 1000, count: 3 },
      { day: '2026-10-11', medianMs: 700, count: 1 },
    ]);
    expect(reactionTrends(logs, dayOf, { limit: 1 })).toHaveLength(1);
  });

  it('切换热力图：平均用时只算正确的；正确率', () => {
    const t = (cardId: string, reactionMs: number, correct = true, ts = T) =>
      log({ cardId, drillType: 'transition', cardKind: 'transition', reactionMs, correct, ts });
    const heat = transitionHeatmap(
      [
        t('transition:c>g:any', 600),
        t('transition:c>g:any', 800),
        t('transition:c>g:any', 100, false),
        t('transition:g>c:any', 900, false),
        t('transition:g>am:any', 500, true, T - 10 * DAY),
      ],
      T - DAY,
    );
    expect(heat.chords).toEqual(['c', 'g']);
    expect(heat.cells).toEqual([
      { from: 'c', to: 'g', meanMs: 700, count: 3, accuracy: 2 / 3 },
      { from: 'g', to: 'c', meanMs: null, count: 1, accuracy: 0 },
    ]);
  });

  it('节拍偏差：只取跟拍练习里弹对的和弦卡；每天的平均与标准差', () => {
    const p = (beatOffsetMs: number | null, over: Partial<ReviewLog> = {}) =>
      log({ drillType: 'progression', reactionMs: null, beatOffsetMs, ...over });
    const s = beatOffsetStats(
      [
        p(10),
        p(-10),
        p(30, { ts: T + DAY }),
        p(500, { correct: false }),
        p(40, { cardKind: 'transition', cardId: 'transition:c>g:any' }),
        p(null),
      ],
      dayOf,
    );
    expect(s.offsets).toEqual([10, -10, 30]);
    expect(s.days).toEqual([
      { day: '2026-10-10', count: 2, meanMs: 0, stdevMs: 10 },
      { day: '2026-10-11', count: 1, meanMs: 30, stdevMs: 0 },
    ]);
  });

  it('总体', () => {
    expect(practiceTotals([], dayOf)).toEqual({ answers: 0, accuracy: null, days: 0 });
    expect(
      practiceTotals(
        [log({}), log({ correct: false, ts: T + DAY }), log({ cardKind: 'topic' })],
        dayOf,
      ),
    ).toEqual({ answers: 2, accuracy: 0.5, days: 2 });
  });
});
