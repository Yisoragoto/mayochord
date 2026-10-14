import 'fake-indexeddb/auto';
import { BUILTIN_PACK } from '@mayochord/content';
import { type ChordAttempt, createDefaultStrategy, voicingMidi } from '@mayochord/core';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MayoChordDB } from '@/storage/db';
import { createDexieRepositories, type Repositories } from '@/storage/repositories';
import { PracticeController, phaseCounts, type Timers } from './controller';
import { cardsForGroup, practiceGroups } from './groups';

const groups = practiceGroups(BUILTIN_PACK);
const ref = (chordId: string) =>
  voicingMidi(BUILTIN_PACK.chordById.get(chordId)?.reference as never);

let db: MayoChordDB;
let repos: Repositories;
let now = 0;
let listeners: ((a: ChordAttempt) => void)[] = [];
let held: number[] = [];
let ids = 0;

/** 手动推进的计时器：时间就是 now */
let queue: { at: number; fn: () => void; id: number }[] = [];
let timerId = 0;
const timers: Timers = {
  set(fn, ms) {
    const id = ++timerId;
    queue.push({ at: now + ms, fn, id });
    return id;
  },
  clear(h) {
    queue = queue.filter((q) => q.id !== h);
  },
};
function runTimersUntil(t: number) {
  for (;;) {
    queue.sort((a, b) => a.at - b.at);
    const next = queue[0];
    if (!next || next.at > t) break;
    queue.shift();
    now = Math.max(now, next.at);
    next.fn();
  }
  now = Math.max(now, t);
}

function controller(over: Partial<ConstructorParameters<typeof PracticeController>[0]> = {}) {
  return new PracticeController({
    pack: BUILTIN_PACK,
    groups,
    repos: () => repos,
    strategy: () => createDefaultStrategy(),
    onAttempt: (cb) => {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter((l) => l !== cb);
      };
    },
    heldNow: () => held,
    onsetWindowMs: () => 80,
    now: () => now,
    wallNow: () => 1_800_000_000_000 + now,
    uuid: () => `id-${ids++}`,
    nextDelayMs: () => 500,
    timers,
    ...over,
  });
}

/** 模拟在 now 之后 dt 毫秒弹出 notes（MIDI，20ms 内按下） */
function play(notes: readonly number[], dt = 800) {
  const t0 = now + dt;
  const onsets: Record<number, number> = {};
  const sources: Record<number, string> = {};
  notes.forEach((n, i) => {
    onsets[n] = t0 + i * 5;
    sources[n] = 'webmidi:juno';
  });
  const last = t0 + (notes.length - 1) * 5;
  runTimersUntil(last + 150);
  held = [...notes];
  const a: ChordAttempt = {
    notes: [...notes].sort((x, y) => x - y),
    newNotes: [...notes],
    onsets,
    sources,
    firstOnset: t0,
    lastOnset: last,
    spreadMs: last - t0,
    together: true,
    stableAt: now,
  };
  for (const l of [...listeners]) l(a);
}

/** 让"下一题"计时器走完 */
function advance(ms: number) {
  runTimersUntil(now + ms);
}

beforeEach(() => {
  queue = [];
  db = new MayoChordDB(`practice-${Date.now()}-${Math.random()}`);
  repos = createDexieRepositories(db);
  now = 0;
  listeners = [];
  held = [];
});

afterEach(async () => {
  db.close();
  await Dexie.delete(db.name);
});

describe('PracticeController', () => {
  it('看名弹和弦：一轮全对 → 日志、卡片进度、总结', async () => {
    const c = controller();
    await c.start({ groupId: 'c-g-am-f', drill: 'name-to-chord', mode: 'any', length: 6 });
    expect(c.view.status).toBe('running');
    // 第一次见到的卡先显示键位
    expect(c.view.trial?.hintVisible).toBe(true);

    for (let i = 0; i < 6; i++) {
      const trial = c.view.trial;
      expect(c.view.index).toBe(i + 1);
      play(ref(trial?.trial.targetChordId as string));
      expect(c.view.result?.correct).toBe(true);
      expect(c.view.trial?.status).toBe('done');
      advance(500);
    }
    expect(c.view.status).toBe('summary');
    expect(c.view.summary).toMatchObject({ total: 6, correct: 6, bestStreak: 6 });
    await c.flush();

    const logs = await repos.reviewLogs.latest(100);
    expect(logs).toHaveLength(6);
    // C 集中练：第一次有提示（Hard），之后 3 次达标进入 ordered；再轮一遍（只有 C），然后开始 G
    expect(logs.slice(0, 4).map((l) => [l.cardId, l.hintUsed, l.rating])).toEqual([
      ['chord:c:name:any', true, 2],
      ['chord:c:name:any', false, 3],
      ['chord:c:name:any', false, 3],
      ['chord:c:name:any', false, 3],
    ]);
    expect(logs[0]).toMatchObject({
      evidence: 'explicit',
      inputSource: 'midi',
      spreadMs: 15,
      contentVersion: BUILTIN_PACK.version,
    });
    const states = await repos.cardStates.getMany(['chord:c:name:any']);
    expect(states.get('chord:c:name:any')).toMatchObject({ phase: 'ordered', attempts: 5 });
    const [session] = await repos.sessions.recent(1);
    expect(session).toMatchObject({ endedAt: expect.any(Number), summary: { total: 6 } });
  });

  it('答错：显示提示，弹对后才进入下一题；超时记为 Again', async () => {
    const c = controller();
    await c.start({ groupId: 'c-g-am-f', drill: 'name-to-chord', mode: 'any', length: 2 });
    play([48, 60, 63, 67]); // Cm 而不是 C
    expect(c.view.result).toMatchObject({ correct: false, rating: 1 });
    expect(c.view.trial).toMatchObject({ status: 'retry', hintVisible: true });
    expect(c.view.streak).toBe(0);
    play(ref('c'));
    expect(c.view.trial?.status).toBe('done');
    advance(500);
    expect(c.view.index).toBe(2);
    // 第二题超时（时限默认 6000ms）
    advance(6100);
    expect(c.view.result).toMatchObject({ correct: false, timedOut: true, rating: 1 });
    c.skip();
    advance(500);
    expect(c.view.status).toBe('summary');
    expect(c.view.summary).toMatchObject({ total: 2, correct: 0, timedOut: 1 });
  });

  it('提示与提前结束', async () => {
    const c = controller();
    await repos.cardStates.put({
      cardId: 'chord:c:name:any',
      memory: null,
      phase: 'mixed',
      streak: 0,
      attempts: 5,
      correct: 5,
      lastSeen: 1,
      lastScheduledDay: null,
    });
    await c.start({ groupId: 'c-g-am-f', drill: 'name-to-chord', mode: 'any', length: 5 });
    // 学过的卡不自动显示提示
    const first = c.view.trial;
    expect(first?.trial.targetChordId).toBe('c');
    expect(first?.hintVisible).toBe(false);
    c.hint();
    expect(c.view.trial).toMatchObject({ hintVisible: true, hintUsed: true });
    play(ref('c'));
    expect(c.view.result?.rating).toBe(2);
    c.finish();
    expect(c.view.status).toBe('summary');
    expect(c.view.summary?.total).toBe(1);
    // 结束后的输入不再处理
    play(ref('g'));
    expect(c.view.summary?.total).toBe(1);
  });

  it('和弦切换：沿用正按着的"从"和弦，记录切换卡', async () => {
    const c = controller();
    held = ref('c');
    await c.start({ groupId: 'c-g-am-f', drill: 'transition', mode: 'any', length: 1 });
    expect(c.view.trial).toMatchObject({
      status: 'awaiting',
      trial: { fromChordId: 'c', targetChordId: 'g' },
    });
    play(ref('g'), 600);
    expect(c.view.result?.correct).toBe(true);
    advance(500);
    await c.flush();
    const [log] = await repos.reviewLogs.latest(1);
    expect(log).toMatchObject({
      cardId: 'transition:c>g:any',
      cardKind: 'transition',
      drillType: 'transition',
    });
  });

  it('没有卡片的组合：empty', async () => {
    const c = controller();
    await c.start({ groupId: 'all', drill: 'transition', mode: 'any', length: 5 });
    expect(c.view.status).toBe('empty');
  });

  it('存储不可用时照常练习，提示无法保存', async () => {
    const c = controller({ repos: () => null });
    await c.start({ groupId: 'c-g-am-f', drill: 'name-to-chord', mode: 'any', length: 1 });
    expect(c.view.saveError).toBe(true);
    play(ref('c'));
    expect(c.view.result?.correct).toBe(true);
  });

  it('85% 规则：连续答对后时限收紧，并保存', async () => {
    await repos.settings.set('adaptive', {
      'name-to-chord': { timeLimitMs: 6000, sinceAdjust: 4 },
    });
    for (let i = 0; i < 12; i++) {
      await repos.reviewLogs.append({
        id: `old-${i}`,
        ts: 1,
        sessionId: null,
        cardId: 'chord:c:name:any',
        cardKind: 'chord',
        drillType: 'name-to-chord',
        evidence: 'explicit',
        weight: 1,
        correct: true,
        reactionMs: 900,
        extraNotes: [],
        missingNotes: [],
        spreadMs: 10,
        beatOffsetMs: null,
        hintUsed: false,
        rating: 3,
        inputSource: 'midi',
        contentVersion: '0.1.0',
      });
    }
    const c = controller();
    await c.start({ groupId: 'c-g-am-f', drill: 'name-to-chord', mode: 'any', length: 2 });
    expect(c.view.timeLimitMs).toBe(6000);
    play(ref(c.view.trial?.trial.targetChordId as string));
    expect(c.view.adaptiveChange).toBe('tighten');
    advance(500);
    expect(c.view.timeLimitMs).toBe(5100);
    await c.flush();
    expect(await repos.settings.get('adaptive')).toMatchObject({
      'name-to-chord': { timeLimitMs: 5100, sinceAdjust: 0 },
    });
  });

  it('phaseCounts', () => {
    const group = groups.find((g) => g.id === 'c-g-am-f');
    const cards = cardsForGroup(group as never, 'name-to-chord', 'any');
    const counts = phaseCounts(
      cards,
      new Map([
        [
          'chord:c:name:any',
          {
            cardId: 'x',
            memory: { due: 5, state: 'review' } as never,
            phase: 'mixed' as const,
            streak: 0,
            attempts: 3,
            correct: 3,
            lastSeen: 1,
            lastScheduledDay: null,
          },
        ],
        [
          'chord:g:name:any',
          {
            cardId: 'y',
            memory: null,
            phase: 'ordered' as const,
            streak: 0,
            attempts: 3,
            correct: 3,
            lastSeen: 1,
            lastScheduledDay: null,
          },
        ],
      ]),
      10,
    );
    expect(counts).toEqual({ total: 4, fresh: 2, learning: 1, mixed: 1, due: 1 });
  });
});
