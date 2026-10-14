import 'fake-indexeddb/auto';
import { BUILTIN_PACK } from '@mayochord/content';
import { type ChordAttempt, createDefaultStrategy } from '@mayochord/core';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MayoChordDB } from '@/storage/db';
import { createDexieRepositories, type Repositories } from '@/storage/repositories';
import type { Timers } from '../practice/controller';
import { type MetronomeLike, ProgressionRunController, type RunConfig } from './run-controller';
import { parseCustomSequence, runSpecFrom, sourceFromProgression } from './run-source';

let db: MayoChordDB;
let repos: Repositories;
let now = 0;
let listeners: ((a: ChordAttempt) => void)[] = [];
let ids = 0;
let stopped = 0;

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

/** 第一拍在 T0；每拍 500 ms（120 BPM） */
const T0 = 10_000;

function controller(startMetronome?: (c: RunConfig) => Promise<MetronomeLike>) {
  return new ProgressionRunController({
    pack: BUILTIN_PACK,
    repos: () => repos,
    strategy: () => createDefaultStrategy(),
    onAttempt: (cb) => {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter((l) => l !== cb);
      };
    },
    startMetronome:
      startMetronome ??
      (async (c) => ({
        grid: { startT: T0, beatMs: 60_000 / c.spec.bpm, beatsPerBar: 4 },
        stop: () => {
          stopped++;
        },
      })),
    now: () => now,
    wallNow: () => 1_800_000_000_000 + now,
    uuid: () => `id-${ids++}`,
    timers,
  });
}

const source = sourceFromProgression(BUILTIN_PACK.progressionById.get('c-g-am-f') as never);

function config(over: Partial<RunConfig> = {}, loops: number | null = 1): RunConfig {
  return {
    kind: 'practice',
    source,
    spec: runSpecFrom(source, {
      bpm: 120,
      beatsPerChord: 2,
      loops,
      voicingMode: 'any',
      hintsVisible: false,
      latencyMs: 0,
      onsetWindowMs: 80,
    }),
    click: { mode: 'all', accent: true },
    adaptiveBpm: true,
    ...over,
  };
}

/** 在 t 时刻弹出第 i 步的和弦（MIDI，10 ms 内按下） */
function playStep(i: number, t: number, source = 'webmidi:juno') {
  const step = config().source.steps[i % 4];
  const notes = (step?.chord.notes ?? []).map((n) => n.midi);
  runTimersUntil(t + 150);
  const onsets: Record<number, number> = {};
  const sources: Record<number, string> = {};
  notes.forEach((n, j) => {
    onsets[n] = t - 5 + (10 * j) / Math.max(1, notes.length - 1);
    sources[n] = source;
  });
  const a: ChordAttempt = {
    notes: [...notes].sort((x, y) => x - y),
    newNotes: notes,
    onsets,
    sources,
    firstOnset: t - 5,
    lastOnset: t + 5,
    spreadMs: 10,
    together: true,
    stableAt: t + 150,
  };
  for (const l of [...listeners]) l(a);
}

beforeEach(() => {
  queue = [];
  db = new MayoChordDB(`run-${Date.now()}-${Math.random()}`);
  repos = createDexieRepositories(db);
  now = 0;
  listeners = [];
  stopped = 0;
});

afterEach(async () => {
  db.close();
  await Dexie.delete(db.name);
});

describe('ProgressionRunController', () => {
  it('一遍全部在拍上：每步写和弦卡 + 切换卡证据、更新卡片进度、总结、建议加快', async () => {
    const c = controller();
    const finished: unknown[] = [];
    await c.start(config());
    c.onFinish((r) => finished.push(r));
    expect(c.view.status).toBe('running');
    for (let i = 0; i < 4; i++) playStep(i, T0 + i * 1000 + 20);
    await c.flush();
    expect(c.view.status).toBe('summary');
    expect(stopped).toBe(1);
    expect(c.view.summary).toMatchObject({ total: 4, correct: 4, cleanRate: 1, missed: 0 });
    // 只有 4 步，不够 85% 规则的最少样本
    expect(c.view.nextBpm).toEqual({ bpm: 120, change: null });
    expect(finished).toHaveLength(1);

    const logs = await repos.reviewLogs.latest(50);
    expect(logs.map((l) => l.cardId)).toEqual([
      'chord:c:name:any',
      'chord:g:name:any',
      'transition:c>g:any',
      'chord:am:name:any',
      'transition:g>am:any',
      'chord:f:name:any',
      'transition:am>f:any',
    ]);
    expect(logs[0]).toMatchObject({
      drillType: 'progression',
      beatOffsetMs: 20,
      rating: 3,
      reactionMs: null,
      inputSource: 'midi',
    });
    // XP 只记在和弦卡上：每步 1 秒
    expect(logs.reduce((s, l) => s + (l.xp ?? 0), 0)).toBeCloseTo(4 / 60, 2);
    expect(c.view.xp).toBeCloseTo(4 / 60, 2);
    const states = await repos.cardStates.getMany(['transition:c>g:any']);
    expect(states.get('transition:c>g:any')?.memory).not.toBeNull();
    const sessions = await repos.sessions.recent(5);
    expect(sessions[0]).toMatchObject({ config: { kind: 'progression', bpm: 120 } });
  });

  it('漏弹：窗口结束后由计时器定下；手动结束只总结已有成绩的步', async () => {
    const c = controller();
    await c.start(config({}, null));
    let completed: boolean | null = null;
    c.onFinish((r) => {
      completed = r.completed;
    });
    playStep(0, T0);
    runTimersUntil(T0 + 2000); // 第 2 步（1000 ms）的窗口在 1750 ms 关闭
    expect(c.view.results.map((r) => r.status)).toEqual(['correct', 'missed']);
    c.stop();
    expect(c.view.status).toBe('summary');
    expect(completed).toBe(false);
    expect(c.view.summary?.total).toBe(2);
    c.stop(); // 已经结束：无效
  });

  it('课程的独立练习：干净地弹对 targetClean 个就结束', async () => {
    const c = controller();
    await c.start(config({ kind: 'independent', targetClean: 3, adaptiveBpm: false }, null));
    let completed: boolean | null = null;
    c.onFinish((r) => {
      completed = r.completed;
    });
    for (let i = 0; i < 3; i++) playStep(i, T0 + i * 1000);
    expect(c.view.status).toBe('summary');
    expect(completed).toBe(true);
    expect(c.view.nextBpm).toBeNull();
  });

  it('节拍器启动失败 → error；中途离开：丢掉结果', async () => {
    const bad = controller(async () => {
      throw new Error('no audio');
    });
    await bad.start(config());
    expect(bad.view.status).toBe('error');

    const c = controller();
    const p = c.start(config());
    c.dispose();
    await p;
    expect(c.view.status).toBe('idle');
    expect(stopped).toBe(1);
  });

  it('存储不可用时照常练习，提示无法保存', async () => {
    const c = new ProgressionRunController({
      pack: BUILTIN_PACK,
      repos: () => {
        throw new Error('no idb');
      },
      strategy: () => createDefaultStrategy(),
      onAttempt: (cb) => {
        listeners.push(cb);
        return () => undefined;
      },
      startMetronome: async () => ({
        grid: { startT: T0, beatMs: 500, beatsPerBar: 4 },
        stop() {},
      }),
      now: () => now,
      wallNow: () => now,
      uuid: () => `x${ids++}`,
      timers,
    });
    await c.start(config());
    playStep(0, T0);
    expect(c.view.saveError).toBe(true);
    expect(c.view.results).toHaveLength(1);
  });
});

describe('自定义序列', () => {
  it('解析和弦名：内容包里有的用参考键位，没有的自动排列；认不出的列出来', () => {
    const ok = parseCustomSequence('FM7 – E7, Am7 | Gm7 C7(9) Dbm7', BUILTIN_PACK, 2);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.source.steps.map((s) => [s.chord.id, s.beats, s.chord.generated])).toEqual([
      ['fmaj7', 2, false],
      ['e7', 2, false],
      ['am7', 2, false],
      ['gm7', 2, false],
      ['c7-9', 2, false],
      ['dbm7', 2, true],
    ]);
    expect(parseCustomSequence('C Hm7 X', BUILTIN_PACK, 4)).toEqual({
      ok: false,
      bad: ['Hm7', 'X'],
    });
    expect(parseCustomSequence('  ', BUILTIN_PACK, 4)).toEqual({ ok: false, bad: [] });
    const spec = runSpecFrom(ok.source, {
      bpm: 90,
      beatsPerChord: 0,
      loops: 2,
      voicingMode: 'reference',
      hintsVisible: true,
      latencyMs: 12,
      onsetWindowMs: 80,
    });
    expect(spec).toMatchObject({ bpm: 90, beatsPerBar: 4, countInBeats: 4, latencyMs: 12 });
    expect(spec.steps[0]).toMatchObject({ chordId: 'fmaj7', beats: 2, slash: false });
  });

  it('斜杠和弦：判定要求最低音', () => {
    const r = parseCustomSequence('C/E', BUILTIN_PACK, 4);
    if (!r.ok) throw new Error('parse');
    const spec = runSpecFrom(r.source, {
      bpm: 90,
      beatsPerChord: 0,
      loops: 1,
      voicingMode: 'any',
      hintsVisible: false,
      latencyMs: 0,
      onsetWindowMs: 80,
    });
    expect(spec.steps[0]).toMatchObject({ chordId: 'c-on-e', slash: true });
  });
});
