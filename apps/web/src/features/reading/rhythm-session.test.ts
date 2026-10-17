import { BUILTIN_PACK, type RhythmEntry } from '@mayochord/content';
import { bpmToBeatMs, createDefaultStrategy, rhythmCard, TPQ } from '@mayochord/core';
import { describe, expect, it, vi } from 'vitest';
import type { RhythmPlayback } from '@/audio/rhythm-play';
import type { SessionResult, SessionSpec } from '@/features/practice/controller';
import { RhythmSessionController } from './rhythm-session';

/** 手动推进的计时器与时钟 */
function setup() {
  let now = 0;
  let queue: { at: number; fn: () => void; id: number }[] = [];
  let timerId = 0;
  let tapListener: ((t: number, source: string) => void) | null = null;
  const plays: { rhythm: RhythmEntry; demo: boolean; startT: number }[] = [];
  const ctl = new RhythmSessionController({
    pack: BUILTIN_PACK,
    repos: () => null,
    strategy: () => createDefaultStrategy(),
    play: async (rhythm, demo, onBeat) => {
      const beatMs = bpmToBeatMs(rhythm.bpm);
      // 预备一小节：第 0 拍在一小节之后
      const startT = now + 200 + 4 * beatMs;
      plays.push({ rhythm, demo, startT });
      onBeat(-4);
      return {
        metronome: { grid: { startT, beatMs, beatsPerBar: 4 }, stop: vi.fn() },
        onsetTimes: rhythm.pattern.onsets.map((tick) => startT + (tick / TPQ) * beatMs),
        stop: vi.fn(),
      } satisfies RhythmPlayback;
    },
    onNoteOn: (cb) => {
      tapListener = cb;
      return () => {
        tapListener = null;
      };
    },
    latencyMs: () => 0,
    now: () => now,
    wallNow: () => 1_800_000_000_000 + now,
    uuid: () => `id-${timerId++}`,
    sourceKind: () => 'midi',
    timers: {
      set(fn, ms) {
        const id = ++timerId;
        queue.push({ at: now + ms, fn, id });
        return id;
      },
      clear(h) {
        queue = queue.filter((q) => q.id !== h);
      },
    },
  });
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  /** 推进到 t（逐个执行到期的计时器，每次之后让异步的 play 完成） */
  const runUntil = async (t: number) => {
    for (;;) {
      queue.sort((a, b) => a.at - b.at);
      const next = queue[0];
      if (!next || next.at > t) break;
      queue.shift();
      now = Math.max(now, next.at);
      next.fn();
      await flush();
    }
    now = Math.max(now, t);
  };
  /** 等到轮到自己弹（节拍器开始），返回这一遍的 play 记录 */
  const untilTurn = async () => {
    for (let i = 0; i < 300; i++) {
      const last = plays[plays.length - 1];
      if (last && !last.demo && ctl.view.phase !== 'judged' && ctl.view.grid) return last;
      await runUntil(now + 100);
    }
    throw new Error('没有轮到');
  };
  const tap = (t: number) => {
    now = Math.max(now, t);
    tapListener?.(t, 'webmidi:juno');
  };
  return { ctl, runUntil, untilTurn, tap, plays, now: () => now };
}

const spec = (over: Partial<SessionSpec> = {}): SessionSpec => ({
  kind: 'mastery',
  cards: [rhythmCard('r-four-q'), rhythmCard('r-q-rest')],
  length: 2,
  order: 'sequential',
  hints: 'never',
  retryWrong: false,
  requireCorrection: false,
  ...over,
});

/** 按谱上的起点按下（offset 毫秒的偏差） */
function tapPattern(
  s: ReturnType<typeof setup>,
  turn: { rhythm: RhythmEntry; startT: number },
  offset = 0,
) {
  const beatMs = bpmToBeatMs(turn.rhythm.bpm);
  for (const tick of turn.rhythm.pattern.onsets) {
    s.tap(turn.startT + (tick / TPQ) * beatMs + offset);
  }
}

describe('节奏读谱的一轮练习', () => {
  it('按准了 → 干净（Good）；没按 → 漏了（Again）；结束时给出 SessionResult', async () => {
    const s = setup();
    let result: SessionResult | null = null;
    await s.ctl.start(spec());
    s.ctl.onFinish((r) => {
      result = r;
    });
    const first = await s.untilTurn();
    expect(first.rhythm.id).toBe('r-four-q');
    tapPattern(s, first, 15);
    await s.runUntil(first.startT + 4 * bpmToBeatMs(72) + 300);
    expect(s.ctl.view.phase).toBe('judged');
    expect(s.ctl.view.judge?.clean).toBe(true);
    expect(s.ctl.view.rating).toBe(3);
    expect(s.ctl.view.marks).toEqual(['ok', 'ok', 'ok', 'ok']);

    const second = await s.untilTurn();
    expect(second.rhythm.id).toBe('r-q-rest');
    await s.runUntil(second.startT + 4 * bpmToBeatMs(72) + 300);
    expect(s.ctl.view.judge?.missed).toBe(2);
    expect(s.ctl.view.rating).toBe(1);
    await s.runUntil(s.now() + 5000);

    expect(s.ctl.view.status).toBe('summary');
    const r = result as unknown as SessionResult;
    expect(r.completed).toBe(true);
    expect(r.logs.map((l) => [l.cardId, l.correct, l.rating, l.cardKind, l.drillType])).toEqual([
      ['rhythm:r-four-q', true, 3, 'rhythm', 'rhythm-reading'],
      ['rhythm:r-q-rest', false, 1, 'rhythm', 'rhythm-reading'],
    ]);
    expect(r.logs[0]?.beatOffsetMs).toBe(15);
    expect(r.summary.accuracy).toBe(0.5);
  });

  it('引导练习先放示范（记为看了提示，最多 Hard）；不在拍上 → Hard', async () => {
    const s = setup();
    await s.ctl.start(spec({ kind: 'guided', hints: 'always', length: 1 }));
    await s.runUntil(s.now() + 1000);
    expect(s.plays[0]?.demo).toBe(true);
    const turn = await s.untilTurn();
    tapPattern(s, turn);
    await s.runUntil(turn.startT + 4 * bpmToBeatMs(72) + 300);
    expect(s.ctl.view.demoed).toBe(true);
    expect(s.ctl.view.rating).toBe(2);

    const t = setup();
    await t.ctl.start(spec({ length: 1 }));
    const turn2 = await t.untilTurn();
    tapPattern(t, turn2, 150);
    await t.runUntil(turn2.startT + 4 * bpmToBeatMs(72) + 300);
    expect(t.ctl.view.judge?.correct).toBe(true);
    expect(t.ctl.view.marks.every((m) => m === 'off')).toBe(true);
    expect(t.ctl.view.rating).toBe(2);
  });

  it('多按算错；预备拍里按的不算；首次答对够数就结束（独立练习）', async () => {
    const s = setup();
    await s.ctl.start(
      spec({
        kind: 'independent',
        order: 'mixed',
        length: 6,
        targetCorrect: 1,
        cards: [rhythmCard('r-four-q')],
      }),
    );
    let turn = await s.untilTurn();
    s.tap(turn.startT - 2000); // 预备拍里
    tapPattern(s, turn);
    s.tap(turn.startT + 1.5 * bpmToBeatMs(72)); // 多按
    await s.runUntil(turn.startT + 4 * bpmToBeatMs(72) + 300);
    expect(s.ctl.view.judge?.extra).toHaveLength(1);
    expect(s.ctl.view.judge?.correct).toBe(false);
    turn = await s.untilTurn();
    tapPattern(s, turn);
    await s.runUntil(turn.startT + 4 * bpmToBeatMs(72) + 300);
    expect(s.ctl.view.correctCount).toBe(1);
    await s.runUntil(s.now() + 5000);
    expect(s.ctl.view.status).toBe('summary');
  });

  it('没有节奏卡 → empty；中途结束 → completed = false', async () => {
    const s = setup();
    await s.ctl.start(spec({ cards: [] }));
    expect(s.ctl.view.status).toBe('empty');
    let completed: boolean | null = null;
    await s.ctl.start(spec());
    s.ctl.onFinish((r) => {
      completed = r.completed;
    });
    s.ctl.finish();
    expect(completed).toBe(false);
  });
});
