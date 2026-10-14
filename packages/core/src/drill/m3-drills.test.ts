import { describe, expect, it } from 'vitest';
import { masteryPassed, topicRating } from '../grading/topic';
import { currentStreak, detectMashing, lastDays, trialXp, xpByDay } from '../grading/xp';
import type { InputEvent } from '../input/events';
import { judgeNotes } from '../recognition/judge';
import { emptyProgress } from '../scheduler/progress';
import { PracticeSession, SequentialSession, seededRng } from '../scheduler/session';
import { closeVoicing } from '../voicing/close';
import {
  chordCard,
  chordCardsFor,
  intervalCard,
  intervalCardId,
  noteCard,
  noteCardId,
} from './cards';
import {
  type DrillContext,
  drillForCard,
  intervalDrill,
  nameToChordDrill,
  nameToNoteDrill,
} from './drill';
import { intervalCardTarget, noteCardTarget } from './targets';

const on = (note: number, t: number): InputEvent => ({
  kind: 'noteOn',
  note,
  velocity: 80,
  channel: 1,
  t,
  source: 'webmidi:x',
});

const ctx = (over: Partial<DrillContext> = {}): DrillContext => ({
  referenceNotes: () => [52, 60, 64, 67],
  timeLimitMs: 5000,
  onsetWindowMs: 80,
  hintAtStart: false,
  trialId: 't',
  ...over,
});

describe('closeVoicing', () => {
  const names = (rh: ReturnType<typeof closeVoicing>) => rh.map((n) => n.name);

  it('三和弦：左手根音 + 右手原位密集排列', () => {
    expect(names(closeVoicing('D', 'maj'))).toEqual(['D3', 'D4', 'F#4', 'A4']);
    expect(closeVoicing('D', 'maj').map((n) => n.finger)).toEqual([5, 1, 3, 5]);
    expect(names(closeVoicing('Eb', 'm'))).toEqual(['Eb3', 'Eb4', 'Gb4', 'Bb4']);
    expect(names(closeVoicing('B', 'm'))).toEqual(['B3', 'B4', 'D5', 'F#5']);
  });

  it('七和弦四个音、九和弦省略五音；斜杠和弦用对应转位', () => {
    expect(names(closeVoicing('C', 'M7'))).toEqual(['C3', 'C4', 'E4', 'G4', 'B4']);
    expect(closeVoicing('C', 'M7').map((n) => n.finger)).toEqual([5, 1, 2, 3, 5]);
    expect(names(closeVoicing('C', '7(9)'))).toEqual(['C3', 'C4', 'E4', 'Bb4', 'D5']);
    expect(names(closeVoicing('C', 'maj', 'E'))).toEqual(['E3', 'E4', 'G4', 'C5']);
    expect(names(closeVoicing('A', 'm', 'C'))).toEqual(['C3', 'C4', 'E4', 'A4']);
  });
});

describe('低音判定模式', () => {
  it('音级都对但最低音不对 → wrongBass', () => {
    const target = [52, 64, 67, 72]; // C/E
    expect(judgeNotes([64, 67, 72], target, 'bass').correct).toBe(true);
    expect(judgeNotes([60, 64, 67], target, 'bass')).toEqual({
      correct: false,
      extra: [],
      missing: [],
      wrongBass: true,
    });
    expect(judgeNotes([60, 64, 67], target, 'loose').correct).toBe(true);
  });

  it('斜杠和弦题用低音模式；低音不对立即判错（不当作没弹完）', () => {
    const trial = nameToChordDrill.createTrial(chordCard('c-on-e'), ctx({ hasBass: () => true }));
    expect(trial.mode).toBe('bass');
    const s = nameToChordDrill.evaluate(
      trial,
      0,
      [on(60, 100), on(64, 105), on(67, 110)],
      {},
      1000,
    );
    expect(s.status).toBe('retry');
    expect(s.feedback?.judge.wrongBass).toBe(true);
  });
});

describe('认音名、音程', () => {
  it('卡片 ID 与示范位置', () => {
    expect(noteCardId('Eb')).toBe('note:eb');
    expect(noteCardId('F#')).toBe('note:fs');
    expect(intervalCardId('E', 'm2')).toBe('interval:e:m2');
    expect(noteCardTarget(noteCard('Bb'))).toEqual([
      { name: 'Bb4', midi: 70, hand: 'right', finger: 2 },
    ]);
    expect(intervalCardTarget(intervalCard('E', 'm2')).map((n) => n.name)).toEqual(['E4', 'F4']);
    expect(intervalCardTarget(intervalCard('B', 'M3')).map((n) => n.name)).toEqual(['B4', 'D#5']);
    expect(intervalCardTarget(intervalCard('A', 'm3')).map((n) => n.midi)).toEqual([69, 72]);
    expect(intervalCardTarget(intervalCard('C', 'P5')).map((n) => n.name)).toEqual(['C4', 'G4']);
  });

  it('认音名：任意八度都算对', () => {
    const card = noteCard('Eb');
    expect(drillForCard(card)).toBe(nameToNoteDrill);
    const trial = nameToNoteDrill.createTrial(card, ctx());
    const s = nameToNoteDrill.evaluate(trial, 0, [on(39, 500)], {}, 1000);
    expect(s.outcome).toMatchObject({ correct: true, reactionMs: 500 });
    expect(
      nameToNoteDrill.toEvidence(trial, s.outcome as NonNullable<typeof s.outcome>)[0],
    ).toMatchObject({
      cardKind: 'note',
      drillType: 'name-to-note',
    });
  });

  it('音程：最低音必须是根音', () => {
    const card = intervalCard('E', 'm2');
    expect(drillForCard(card)).toBe(intervalDrill);
    const trial = intervalDrill.createTrial(card, ctx());
    expect(trial.mode).toBe('bass');
    const ok = intervalDrill.evaluate(trial, 0, [on(52, 100), on(53, 110)], {}, 1000);
    expect(ok.outcome?.correct).toBe(true);
    // F 在下面：不对
    const bad = intervalDrill.evaluate(trial, 0, [on(53, 100), on(64, 110)], {}, 1000);
    expect(bad.outcome?.correct).toBe(false);
    expect(
      intervalDrill.toEvidence(trial, ok.outcome as NonNullable<typeof ok.outcome>)[0]?.cardKind,
    ).toBe('interval');
  });
});

describe('XP 与乱按', () => {
  it('trialXp：按时长计、单题封顶、乱按为 0', () => {
    expect(trialXp(6000, false)).toBeCloseTo(0.1);
    expect(trialXp(120_000, false)).toBeCloseTo(20 / 60);
    expect(trialXp(6000, true)).toBe(0);
    expect(trialXp(0, false)).toBe(0);
  });

  it('detectMashing：大量无关音、或 1 秒内按太多', () => {
    const target = [60, 64, 67];
    expect(
      detectMashing(
        [60, 64, 67].map((note, i) => ({ note, t: i * 10 })),
        target,
      ),
    ).toBe(false);
    const foreign = [61, 62, 63, 65, 66, 68, 69].map((note, i) => ({ note, t: i * 500 }));
    expect(detectMashing(foreign, target)).toBe(true);
    const burst = Array.from({ length: 11 }, (_, i) => ({ note: 60 + (i % 3) * 4, t: i * 50 }));
    expect(detectMashing(burst, target)).toBe(true);
    const slow = Array.from({ length: 11 }, (_, i) => ({ note: 60, t: i * 200 }));
    expect(detectMashing(slow, target)).toBe(false);
  });

  it('每日 XP、连续天数、最近几天', () => {
    const day = (ts: number) => new Date(ts).toISOString().slice(0, 10);
    const D = (d: number) => Date.UTC(2026, 9, d, 12);
    const xp = xpByDay(
      [
        { ts: D(10), xp: 2 },
        { ts: D(12), xp: 0.6 },
        { ts: D(12), xp: 0.6 },
        { ts: D(13), xp: 3 },
        { ts: D(13) },
      ],
      day,
    );
    expect(xp.get('2026-10-12')).toBeCloseTo(1.2);
    expect(currentStreak(xp, '2026-10-13')).toBe(2);
    // 今天还没练：从昨天数起
    expect(currentStreak(xp, '2026-10-14')).toBe(2);
    expect(currentStreak(xp, '2026-10-16')).toBe(0);
    expect(lastDays(xp, '2026-10-13', 3).map((d) => d.xp)).toEqual([0, xp.get('2026-10-12'), 3]);
  });
});

describe('主题评分、掌握检查', () => {
  const r = (correct: boolean, rating: 1 | 2 | 3 | 4 | null = correct ? 3 : 1) => ({
    correct,
    rating,
  });

  it('topicRating', () => {
    expect(topicRating([])).toBeNull();
    expect(topicRating([r(true), r(false), r(false), r(true)])).toBe(1);
    expect(topicRating([...Array(8).fill(r(true)), r(false), r(false)])).toBe(2);
    expect(topicRating(Array(10).fill(r(true)))).toBe(3);
    expect(topicRating(Array(10).fill(r(true, 4)))).toBe(4);
    expect(topicRating(Array(10).fill(r(true, null)))).toBe(3);
  });

  it('masteryPassed', () => {
    expect(masteryPassed([], 0.9)).toBe(false);
    expect(
      masteryPassed(
        Array(9)
          .fill({ correct: true })
          .concat([{ correct: false }]),
        0.9,
      ),
    ).toBe(true);
    expect(masteryPassed([{ correct: true }], 0.9, 4)).toBe(false);
  });
});

describe('出题器', () => {
  it('SequentialSession：按顺序每张卡一次', () => {
    const cards = chordCardsFor(['c', 'g']);
    const s = new SequentialSession(cards);
    expect(s.length).toBe(2);
    expect(s.next()?.card.id).toBe(cards[0]?.id);
    s.record();
    expect(s.next()?.card.id).toBe(cards[1]?.id);
    expect(s.next()).toBeNull();
    expect(s.completed).toBe(1);
  });

  it('retryWrong = false：答错不重做', () => {
    const cards = chordCardsFor(['c', 'g', 'am', 'f']);
    const progress = new Map(
      cards.map((c) => [c.id, { ...emptyProgress(c.id), phase: 'mixed' as const }]),
    );
    const s = new PracticeSession(cards, progress, { length: 8, retryWrong: false }, seededRng(4));
    const reasons: string[] = [];
    for (;;) {
      const item = s.next();
      if (!item) break;
      reasons.push(item.reason);
      s.record(item.card.id, progress.get(item.card.id) as never, false);
    }
    expect(reasons).not.toContain('retry');
  });
});
