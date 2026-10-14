import { describe, expect, it } from 'vitest';
import { chordCardsFor, transitionCardsFor } from '../drill/cards';
import type { Evidence } from '../drill/drill';
import { gradeEvidence, median, personalMedian } from '../grading/grade';
import type { Rating, ReviewLog } from '../log/review-log';
import { createDefaultStrategy } from '../strategy/default';
import { adaptTimeLimit, DEFAULT_ADAPTIVE, initialAdaptiveState } from './adaptive';
import { newMemory, retrievability, reviewMemory } from './memory';
import {
  applyLog,
  type CardProgress,
  DEFAULT_PROGRESS,
  dayKey,
  emptyProgress,
  isDue,
  isPass,
  replayProgress,
} from './progress';
import { PracticeSession, seededRng, shuffle } from './session';
import { summarizeSession } from './summary';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 14, 12); // 2026-10-14 12:00 UTC

let seq = 0;
const log = (over: Partial<ReviewLog> = {}): ReviewLog => ({
  id: `l${seq++}`,
  ts: T0,
  sessionId: 's',
  cardId: 'chord:am:name:any',
  cardKind: 'chord',
  drillType: 'name-to-chord',
  evidence: 'explicit',
  weight: 1,
  correct: true,
  reactionMs: 1000,
  extraNotes: [],
  missingNotes: [],
  spreadMs: 20,
  beatOffsetMs: null,
  hintUsed: false,
  rating: 3,
  inputSource: 'midi',
  contentVersion: '1.0.0',
  ...over,
});

describe('grading', () => {
  const base = {
    correct: true,
    timedOut: false,
    reactionMs: 1000,
    hintUsed: false,
    together: true,
  };

  it('规格 6.4 的五条规则', () => {
    expect(gradeEvidence({ ...base, correct: false }, 1000)).toBe(1);
    expect(gradeEvidence({ ...base, timedOut: true }, 1000)).toBe(1);
    expect(gradeEvidence({ ...base, reactionMs: 1600 }, 1000)).toBe(2);
    expect(gradeEvidence({ ...base, reactionMs: 1500 }, 1000)).toBe(3);
    expect(gradeEvidence({ ...base, reactionMs: 599 }, 1000)).toBe(4);
    expect(gradeEvidence({ ...base, reactionMs: 500, hintUsed: true }, 1000)).toBe(2);
    expect(gradeEvidence({ ...base, reactionMs: 1600, hintUsed: true }, 1000)).toBe(2);
  });

  it('没有个人中位数时正确记 Good；没同时落下最多 Hard', () => {
    expect(gradeEvidence({ ...base, reactionMs: 100 }, null)).toBe(3);
    expect(gradeEvidence({ ...base, together: false }, 1000)).toBe(2);
    expect(gradeEvidence({ ...base, together: null }, 1000)).toBe(3);
  });

  it('median', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('个人中位数：同练习类型、同输入源、正确无提示，至少 5 条，最多取最近 50 条', () => {
    const logs = [
      ...Array.from({ length: 4 }, (_, i) => log({ reactionMs: 1000 + i })),
      log({ reactionMs: 99999, correct: false }),
      log({ reactionMs: 99999, hintUsed: true }),
      log({ reactionMs: 99999, inputSource: 'onscreen' }),
      log({ reactionMs: 99999, drillType: 'transition' }),
      log({ reactionMs: 99999, evidence: 'implicit' }),
      log({ reactionMs: null }),
    ];
    const f = { drillType: 'name-to-chord', inputSource: 'midi' as const };
    expect(personalMedian(logs, f)).toBeNull();
    expect(personalMedian([...logs, log({ reactionMs: 1004 })], f)).toBe(1002);
    const many = [
      ...Array.from({ length: 50 }, () => log({ reactionMs: 5000 })),
      ...Array.from({ length: 50 }, () => log({ reactionMs: 1000 })),
    ];
    expect(personalMedian(many, f)).toBe(1000);
  });
});

describe('FSRS 记忆', () => {
  it('新卡评 Good 后按天安排；Again 的间隔更短', () => {
    const good = reviewMemory(null, 3, T0);
    const again = reviewMemory(null, 1, T0);
    expect(good.state).toBe('review');
    expect(good.reps).toBe(1);
    expect(good.due).toBeGreaterThanOrEqual(T0 + DAY);
    expect(again.due).toBeLessThan(good.due);
    expect(good.lastReview).toBe(T0);
    const later = reviewMemory(good, 3, good.due);
    expect(later.due - good.due).toBeGreaterThan(good.due - T0);
    expect(newMemory(T0)).toMatchObject({ state: 'new', reps: 0, lastReview: null });
  });

  it('回忆概率随时间下降；新卡为 null', () => {
    const m = reviewMemory(null, 3, T0);
    expect(retrievability(null, T0)).toBeNull();
    expect(retrievability(newMemory(T0), T0)).toBeNull();
    const r1 = retrievability(m, T0 + DAY) as number;
    const r2 = retrievability(m, T0 + 30 * DAY) as number;
    expect(r1).toBeGreaterThan(r2);
  });
});

describe('卡片进度', () => {
  const params = { ...DEFAULT_PROGRESS, day: { dayStartHour: 4, tzOffsetMinutes: -480 } };

  it('dayKey：东八区凌晨 4 点前算前一天', () => {
    // 2026-10-14 19:00 UTC = 10-15 03:00 北京时间 → 10-14
    expect(dayKey(Date.UTC(2026, 9, 14, 19), params.day)).toBe('2026-10-14');
    expect(dayKey(Date.UTC(2026, 9, 14, 21), params.day)).toBe('2026-10-15');
  });

  it('isPass：正确、无提示、至少 Good', () => {
    expect(isPass(log())).toBe(true);
    expect(isPass(log({ rating: 2 }))).toBe(false);
    expect(isPass(log({ hintUsed: true }))).toBe(false);
    expect(isPass(log({ correct: false, rating: 1 }))).toBe(false);
    expect(isPass(log({ rating: null }))).toBe(false);
  });

  it('连续 3 次达标进入下一阶段；答错清零连续次数', () => {
    const id = 'chord:am:name:any';
    const passes = (n: number, start: number) =>
      Array.from({ length: n }, (_, i) => log({ ts: T0 + (start + i) * 1000 }));
    let p = replayProgress(id, passes(2, 0), params);
    expect(p).toMatchObject({ phase: 'focused', streak: 2, attempts: 2, correct: 2 });
    p = applyLog(p, log({ ts: T0 + 3000, correct: false, rating: 1 }), params);
    expect(p).toMatchObject({ phase: 'focused', streak: 0, attempts: 3, correct: 2 });
    p = replayProgress(id, passes(3, 0), params);
    expect(p).toMatchObject({ phase: 'ordered', streak: 0 });
    p = replayProgress(id, passes(6, 0), params);
    expect(p).toMatchObject({ phase: 'mixed', streak: 0 });
    p = replayProgress(id, passes(9, 0), params);
    expect(p).toMatchObject({ phase: 'mixed', streak: 3 });
  });

  it('FSRS 只用每个练习日的第一次评分', () => {
    const id = 'chord:am:name:any';
    const p1 = replayProgress(id, [log({ ts: T0, rating: 1, correct: false })], params);
    const p2 = replayProgress(
      id,
      [log({ ts: T0, rating: 1, correct: false }), log({ ts: T0 + 60_000, rating: 4 })],
      params,
    );
    expect(p2.memory).toEqual(p1.memory);
    const p3 = replayProgress(
      id,
      [log({ ts: T0, rating: 1, correct: false }), log({ ts: T0 + DAY, rating: 3 })],
      params,
    );
    expect(p3.memory?.reps).toBe(2);
  });

  it('忽略其他卡片、隐式证据和未评分的日志', () => {
    const p = emptyProgress('chord:am:name:any');
    expect(applyLog(p, log({ cardId: 'other' }))).toBe(p);
    expect(applyLog(p, log({ evidence: 'implicit' }))).toBe(p);
    expect(applyLog(p, log({ rating: null }))).toBe(p);
  });

  it('isDue：新卡不算到期', () => {
    const p = replayProgress('chord:am:name:any', [log()], params);
    expect(isDue(emptyProgress('x'), T0)).toBe(false);
    expect(isDue(p, T0)).toBe(false);
    expect(isDue(p, (p.memory?.due as number) + 1)).toBe(true);
  });
});

describe('练习内出题顺序', () => {
  const cards = chordCardsFor(['c', 'g', 'am', 'f']);
  const progressOf = (phase: CardProgress['phase']) =>
    new Map(cards.map((c) => [c.id, { ...emptyProgress(c.id), phase }]));

  /** 模拟一轮练习：answer 决定每题对错，返回出题的和弦序列 */
  function run(
    session: PracticeSession,
    answer: (cardId: string, i: number) => boolean,
    strategy = createDefaultStrategy(),
  ) {
    const progress = new Map<string, CardProgress>();
    const out: { id: string; reason: string }[] = [];
    for (let i = 0; ; i++) {
      const item = session.next();
      if (!item) break;
      const correct = answer(item.card.id, i);
      const p = strategy.applyLog(
        progress.get(item.card.id) ?? {
          ...emptyProgress(item.card.id),
          phase: session.phaseOf(item.card.id),
        },
        log({ cardId: item.card.id, ts: T0 + i, correct, rating: correct ? 3 : 1 }),
      );
      progress.set(item.card.id, p);
      session.record(item.card.id, p, correct);
      out.push({ id: item.card.id.split(':')[1] as string, reason: item.reason });
    }
    return out;
  }

  it('新卡：集中练 3 次达标后，先把已有的卡轮一遍，再开始下一张新卡', () => {
    const s = new PracticeSession(cards, new Map(), { length: 12 }, seededRng(1));
    const seq = run(s, () => true);
    expect(seq.map((x) => x.id)).toEqual([
      'c',
      'c',
      'c',
      'c',
      'g',
      'g',
      'g',
      'c',
      'g',
      'am',
      'am',
      'am',
    ]);
    expect(seq.slice(0, 3).every((x) => x.reason === 'focus')).toBe(true);
    expect(seq[3]?.reason).toBe('ordered');
    expect(s.completed).toBe(12);
    expect(s.length).toBe(12);
  });

  it('集中练一直不达标：最多 maxFocusReps 次就先放一放', () => {
    const s = new PracticeSession(cards, new Map(), { length: 8, maxFocusReps: 4 }, seededRng(1));
    const seq = run(s, (id) => !id.includes(':c:'));
    expect(seq.slice(0, 4).map((x) => x.id)).toEqual(['c', 'c', 'c', 'c']);
    // 先轮一遍（只有 c），再开始 g
    expect(seq[4]?.id).toBe('c');
    expect(seq[5]?.id).toBe('g');
  });

  it('ordered 阶段按原顺序循环；相邻两题不重复', () => {
    const s = new PracticeSession(cards, progressOf('ordered'), { length: 8 }, seededRng(2));
    const seq = run(s, () => true).map((x) => x.id);
    expect(seq.slice(0, 4)).toEqual(['c', 'g', 'am', 'f']);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
  });

  it('mixed 阶段打乱顺序；相邻两题不重复', () => {
    const s = new PracticeSession(cards, progressOf('mixed'), { length: 40 }, seededRng(3));
    const seq = run(s, () => true).map((x) => x.id);
    expect(new Set(seq.slice(0, 4))).toEqual(new Set(['c', 'g', 'am', 'f']));
    expect(seq.slice(0, 8).join()).not.toBe('c,g,am,f,c,g,am,f');
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
  });

  it('答错的卡在 3–5 题后再出现', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = new PracticeSession(cards, progressOf('mixed'), { length: 12 }, seededRng(seed));
      let wrongAt = -1;
      const seq = run(s, (_id, i) => {
        if (i === 2) {
          wrongAt = i;
          return false;
        }
        return true;
      });
      const wrongCard = seq[wrongAt]?.id;
      const retryIdx = seq.findIndex((x, i) => i > wrongAt && x.reason === 'retry');
      expect(seq[retryIdx]?.id).toBe(wrongCard);
      const gap = retryIdx - wrongAt - 1;
      expect(gap).toBeGreaterThanOrEqual(3);
      expect(gap).toBeLessThanOrEqual(5);
    }
  });

  it('只有一张卡、没有卡', () => {
    const one = chordCardsFor(['c']);
    const s = new PracticeSession(
      one,
      new Map([[one[0]?.id as string, { ...emptyProgress('x'), phase: 'mixed' as const }]]),
      { length: 3 },
      seededRng(1),
    );
    expect(run(s, () => true).map((x) => x.id)).toEqual(['c', 'c', 'c']);
    expect(new PracticeSession([], new Map()).next()).toBeNull();
  });

  it('切换卡也适用', () => {
    const tc = transitionCardsFor(['c', 'g', 'am', 'f'], { cyclic: true });
    const s = new PracticeSession(tc, new Map(), { length: 4 }, seededRng(1));
    expect(run(s, () => true).map((x) => x.id)).toEqual(['c>g', 'c>g', 'c>g', 'c>g']);
  });

  it('shuffle 不改变元素', () => {
    const xs = [1, 2, 3, 4, 5];
    expect(shuffle(xs, seededRng(9)).sort()).toEqual(xs);
  });
});

describe('85% 自适应', () => {
  const { params, initialMs } = DEFAULT_ADAPTIVE['name-to-chord'];
  const results = (correct: number, total: number) =>
    Array.from({ length: total }, (_, i) => i < correct);

  it('样本不足或冷却中不调整', () => {
    const s = initialAdaptiveState(initialMs);
    expect(adaptTimeLimit(s, results(5, 5), params)).toEqual({
      state: { timeLimitMs: initialMs, sinceAdjust: 1 },
      change: null,
    });
    expect(
      adaptTimeLimit({ timeLimitMs: 6000, sinceAdjust: 0 }, results(20, 20), params).change,
    ).toBeNull();
  });

  it('高于 90% 收紧，低于 75% 放宽，75–90% 不变', () => {
    const s = { timeLimitMs: 6000, sinceAdjust: 10 };
    expect(adaptTimeLimit(s, results(19, 20), params)).toEqual({
      state: { timeLimitMs: 5100, sinceAdjust: 0 },
      change: 'tighten',
    });
    expect(adaptTimeLimit(s, results(14, 20), params)).toEqual({
      state: { timeLimitMs: 7200, sinceAdjust: 0 },
      change: 'loosen',
    });
    expect(adaptTimeLimit(s, results(17, 20), params).change).toBeNull();
  });

  it('不超出上下限', () => {
    expect(
      adaptTimeLimit({ timeLimitMs: 1500, sinceAdjust: 10 }, results(20, 20), params),
    ).toMatchObject({ state: { timeLimitMs: 1500 }, change: null });
    expect(
      adaptTimeLimit({ timeLimitMs: 14000, sinceAdjust: 10 }, results(0, 20), params).state
        .timeLimitMs,
    ).toBe(15000);
  });
});

describe('轮次总结', () => {
  const ev = (over: Partial<Evidence>): Evidence => ({
    cardId: 'chord:c:name:any',
    cardKind: 'chord',
    drillType: 'name-to-chord',
    correct: true,
    timedOut: false,
    reactionMs: 1000,
    extraNotes: [],
    missingNotes: [],
    spreadMs: 20,
    together: true,
    hintUsed: false,
    inputSource: 'midi',
    ...over,
  });

  it('正确率、最慢的和弦与切换、齐整度、最长连对', () => {
    const s = summarizeSession([
      ev({}),
      ev({ cardId: 'chord:g:name:any', reactionMs: 3000 }),
      ev({ cardId: 'chord:g:name:any', reactionMs: 1000 }),
      ev({ correct: false, reactionMs: 9000, spreadMs: 500 }),
      ev({ timedOut: true, correct: false, reactionMs: null }),
      ev({
        cardId: 'transition:c>g:any',
        cardKind: 'transition',
        reactionMs: 700,
        spreadMs: null,
        together: null,
      }),
      ev({ spreadMs: 100, together: false, hintUsed: true }),
    ]);
    expect(s).toMatchObject({
      total: 7,
      correct: 5,
      timedOut: 1,
      hintsUsed: 1,
      slowestChord: { cardId: 'chord:g:name:any', meanReactionMs: 2000, count: 2 },
      slowestTransition: { cardId: 'transition:c>g:any', meanReactionMs: 700 },
      meanSpreadMs: 40,
      notTogether: 1,
      bestStreak: 3,
    });
    expect(s.accuracy).toBeCloseTo(5 / 7);
  });

  it('空的总结', () => {
    expect(summarizeSession([])).toMatchObject({
      total: 0,
      accuracy: 0,
      meanReactionMs: null,
      slowestChord: null,
      meanSpreadMs: null,
    });
  });
});

describe('默认策略', () => {
  it('评分、进度、新卡示范', () => {
    const s = createDefaultStrategy({ grading: { hardFactor: 2 } });
    expect(
      s.grade(
        { correct: true, timedOut: false, reactionMs: 1800, hintUsed: false, together: true },
        1000,
      ),
    ).toBe(3 as Rating);
    expect(s.hintAtStart(emptyProgress('x'))).toBe(true);
    const p = s.applyLog(emptyProgress('chord:am:name:any'), log());
    expect(s.hintAtStart(p)).toBe(false);
    expect(s.session.length).toBe(20);
  });
});
