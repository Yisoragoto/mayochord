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
    await c.startPractice({ groupId: 'c-g-am-f', drill: 'name-to-chord', mode: 'any', length: 6 });
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
    await c.startPractice({ groupId: 'c-g-am-f', drill: 'name-to-chord', mode: 'any', length: 2 });
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
    await c.startPractice({ groupId: 'c-g-am-f', drill: 'name-to-chord', mode: 'any', length: 5 });
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
    await c.startPractice({ groupId: 'c-g-am-f', drill: 'transition', mode: 'any', length: 1 });
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
    await c.startPractice({ groupId: 'all', drill: 'transition', mode: 'any', length: 5 });
    expect(c.view.status).toBe('empty');
  });

  it('存储不可用时照常练习，提示无法保存', async () => {
    const c = controller({ repos: () => null });
    await c.startPractice({ groupId: 'c-g-am-f', drill: 'name-to-chord', mode: 'any', length: 1 });
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
    await c.startPractice({ groupId: 'c-g-am-f', drill: 'name-to-chord', mode: 'any', length: 2 });
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

describe('SessionSpec：课程与每日任务', () => {
  const topic = (id: string) =>
    BUILTIN_PACK.topicById.get(id) as NonNullable<ReturnType<typeof BUILTIN_PACK.topicById.get>>;
  const noteMidi = (card: { id: string }) => {
    const c = BUILTIN_PACK.cardById.get(card.id);
    if (c?.kind !== 'note') throw new Error(card.id);
    return [
      60 +
        ['c', 'cs', 'd', 'eb', 'e', 'f', 'fs', 'g', 'ab', 'a', 'bb', 'b'].indexOf(card.id.slice(5)),
    ];
  };

  it('引导练习：按顺序、每题显示键位、不限时；结束时回调结果', async () => {
    const c = controller();
    const cards = topic('keyboard-names').cards.slice(0, 3);
    const results: unknown[] = [];
    await c.start({
      kind: 'guided',
      cards,
      length: 3,
      order: 'sequential',
      hints: 'always',
      retryWrong: false,
      requireCorrection: true,
    });
    c.onFinish((r) => results.push(r));
    expect(c.view.timeLimitMs).toBe(600_000);
    for (const card of cards) {
      expect(c.view.trial?.trial.card.id).toBe(card.id);
      expect(c.view.trial?.hintVisible).toBe(true);
      play(noteMidi(card));
      advance(500);
    }
    expect(c.view.status).toBe('summary');
    expect(results).toEqual([
      expect.objectContaining({
        completed: true,
        logs: expect.arrayContaining([expect.objectContaining({ cardKind: 'note' })]),
      }),
    ]);
  });

  it('独立练习：首次答对达到目标就结束', async () => {
    const c = controller();
    const cards = topic('keyboard-names').cards;
    await c.start({
      kind: 'independent',
      cards,
      length: 30,
      order: 'mixed',
      hints: 'auto',
      targetCorrect: 3,
      retryWrong: true,
      requireCorrection: true,
    });
    for (let i = 0; i < 3; i++) {
      play(noteMidi(c.view.trial?.trial.card as { id: string }));
      advance(500);
    }
    expect(c.view.status).toBe('summary');
    expect(c.view.correctCount).toBe(3);
  });

  it('掌握检查：固定时限、不能看提示、答错展示一下就继续', async () => {
    const c = controller();
    let finished: { completed: boolean } | null = null;
    await c.start({
      kind: 'mastery',
      cards: topic('keyboard-names').cards,
      length: 2,
      order: 'mixed',
      hints: 'never',
      fixedTimeLimitMs: 3000,
      retryWrong: false,
      requireCorrection: false,
    });
    c.onFinish((r) => {
      finished = r;
    });
    expect(c.view.timeLimitMs).toBe(3000);
    c.hint();
    expect(c.view.trial?.hintVisible).toBe(false);
    play([61, 62]); // 弹错
    expect(c.view.trial?.status).toBe('retry');
    advance(1500); // 自动跳过
    expect(c.view.trial?.status).toBe('done');
    advance(500);
    expect(c.view.index).toBe(2);
    advance(3100); // 超时 → 自动跳过
    advance(1500);
    advance(500);
    expect(c.view.status).toBe('summary');
    expect(c.view.summary).toMatchObject({ total: 2, correct: 0, timedOut: 1 });
    expect(finished).toMatchObject({ completed: true });
  });

  it('中途结束：completed = false；XP 与乱按写进日志', async () => {
    let noteOn: ((n: number, t: number) => void) | null = null;
    const c = controller({
      onNoteOn: (cb) => {
        noteOn = cb;
        return () => {
          noteOn = null;
        };
      },
    });
    let finished: { completed: boolean; xp: number } | null = null;
    await c.startPractice({ groupId: 'c-g-am-f', drill: 'name-to-chord', mode: 'any', length: 5 });
    c.onFinish((r) => {
      finished = r;
    });
    // 第一题：乱按一通再弹对
    for (let i = 0; i < 12; i++)
      (noteOn as unknown as (n: number, t: number) => void)(40 + i, now + i * 20);
    play(ref('c'), 2000);
    advance(500);
    // 第二题：正常弹对
    play(ref(c.view.trial?.trial.targetChordId as string), 3000);
    c.finish();
    expect(finished).toMatchObject({ completed: false });
    await c.flush();
    const logs = await repos.reviewLogs.latest(10);
    expect(logs.map((l) => l.mashing)).toEqual([true, false]);
    expect(logs[0]?.xp).toBe(0);
    expect(logs[1]?.xp).toBeCloseTo(3.15 / 60, 2);
    expect(c.view.xp).toBeCloseTo(logs[1]?.xp as number);
    const [session] = await repos.sessions.recent(1);
    expect(session?.xp).toBeCloseTo(logs[1]?.xp as number, 3);
    expect(session?.config).toMatchObject({ kind: 'practice', groupId: 'c-g-am-f' });
  });

  it('斜杠和弦用低音判定；熟练的卡减少实时反馈', async () => {
    await repos.cardStates.put({
      cardId: 'chord:c-on-e:name:any',
      memory: {
        due: 0,
        stability: 10,
        difficulty: 5,
        scheduledDays: 10,
        learningSteps: 0,
        reps: 3,
        lapses: 0,
        state: 'review',
        lastReview: 0,
      },
      phase: 'mixed',
      streak: 0,
      attempts: 9,
      correct: 9,
      lastSeen: 1,
      lastScheduledDay: null,
    });
    const c = controller();
    await c.start({
      kind: 'review',
      cards: topic('inversions').cards.filter((x) => x.id === 'chord:c-on-e:name:any'),
      length: 1,
      order: 'mixed',
      hints: 'auto',
      retryWrong: true,
      requireCorrection: true,
    });
    expect(c.view.trial?.trial.mode).toBe('bass');
    expect(c.view.feedback).toBe('minimal');
    play([60, 64, 67]); // 原位 C：最低音不对
    expect(c.view.trial?.feedback?.judge.wrongBass).toBe(true);
  });
});
