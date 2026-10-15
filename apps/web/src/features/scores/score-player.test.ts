import 'fake-indexeddb/auto';
import { parseMusicXml, TPQ } from '@mayochord/core';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MayoChordDB } from '@/storage/db';
import { createDexieRepositories, type Repositories } from '@/storage/repositories';
import type { Timers } from '../practice/controller';
import {
  countInBeatsLeft,
  effectiveBpm,
  playheadTick,
  type ScorePlayConfig,
  ScorePlayer,
} from './score-player';

/**
 * 一个 4/4 小节，divisions = 2：
 * 右手 C4 D4 E4 F4（四分音符）；左手 C3（附点四分）+ G2（八分，第 2 拍后半，只有左手）+ 二分休止。
 */
const XML = `<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes><sound tempo="120"/>${[
  'C',
  'D',
  'E',
  'F',
]
  .map(
    (s) =>
      `<note><pitch><step>${s}</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`,
  )
  .join(
    '',
  )}<backup><duration>8</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>3</duration><voice>2</voice><type>quarter</type><dot/><staff>2</staff></note><note><pitch><step>G</step><octave>2</octave></pitch><duration>1</duration><voice>2</voice><type>eighth</type><staff>2</staff></note><note><rest/><duration>4</duration><voice>2</voice><type>half</type><staff>2</staff></note></measure></part></score-partwise>`;
const score = parseMusicXml(XML, 'Test');

let db: MayoChordDB;
let repos: Repositories;
let now = 0;
let ids = 0;
let listeners: ((p: number, t: number) => void)[] = [];
let played: { pitches: number[]; at: number | null; dur: number }[] = [];
let metronomes: { bpm: number; countInBeats: number; click: boolean; stopped: boolean }[] = [];
let silenced = 0;

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
function advance(to: number) {
  for (;;) {
    queue.sort((a, b) => a.at - b.at);
    const next = queue[0];
    if (!next || next.at > to) break;
    queue.shift();
    now = Math.max(now, next.at);
    next.fn();
  }
  now = Math.max(now, to);
}
const press = (pitch: number, t = now) => {
  advance(t);
  for (const l of [...listeners]) l(pitch, t);
};

/** 第 0 拍在 T0；120 BPM：一拍 500 ms，1 tick = 500 / 960 ms */
const T0 = 10_000;

function player(failPiano = false) {
  return new ScorePlayer({
    onNoteOn: (cb) => {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter((l) => l !== cb);
      };
    },
    startMetronome: async (o) => {
      const m = { ...o, stopped: false };
      metronomes.push(m);
      return {
        startT: T0,
        stop: () => {
          m.stopped = true;
        },
      };
    },
    preparePiano: async () => {
      if (failPiano) throw new Error('no audio');
    },
    playNow: (pitches, dur) => played.push({ pitches: [...pitches], at: null, dur }),
    playAt: (pitches, at, dur) => played.push({ pitches: [...pitches], at, dur }),
    silence: () => {
      silenced++;
    },
    repos: () => repos,
    now: () => now,
    wallNow: () => 1_800_000_000_000 + now,
    uuid: () => `id-${ids++}`,
    timers,
  });
}

function config(over: Partial<ScorePlayConfig> = {}): ScorePlayConfig {
  return {
    scoreId: 'score-1',
    score,
    mode: 'wait',
    hands: 'right',
    otherHand: 'play',
    from: 0,
    to: 0,
    speed: 1,
    loops: 1,
    metronome: true,
    latencyMs: 0,
    ...over,
  };
}

beforeEach(async () => {
  db = new MayoChordDB(`score-player-${Date.now()}-${Math.random()}`);
  repos = createDexieRepositories(db);
  await repos.scores.put({
    id: 'score-1',
    title: 'Test',
    fileName: 't.musicxml',
    format: 'musicxml',
    importedAt: 1,
    source: { kind: 'musicxml', text: XML },
    measureCount: 1,
    noteCount: score.notes.length,
    prefs: null,
    lastPlayedAt: null,
  });
  now = 0;
  ids = 0;
  listeners = [];
  played = [];
  metronomes = [];
  silenced = 0;
  queue = [];
});

afterEach(async () => {
  db.close();
  await Dexie.delete(db.name);
});

describe('ScorePlayer: wait mode', () => {
  it('waits for the right notes, plays the other hand, and saves the run', async () => {
    const p = player();
    await p.start(config());
    expect(p.view.status).toBe('running');
    // 第一组：右手 C4，左手 C3 由网页弹出
    expect(played[0]?.pitches).toEqual([48]);
    press(61, 100);
    expect(p.view.wrong).toEqual([61]);
    press(60, 200);
    expect(p.view.k).toBe(1);
    expect(p.view.marks.get(score.notes.find((n) => n.pitch === 60)?.id ?? -1)).toBe('bad');
    press(62, 300);
    // 第三组是只有左手的 G2：网页弹出，过 1/2 拍（250 ms）后自动往下走
    expect(played[1]?.pitches).toEqual([43]);
    press(64, 350); // 这时按的不算
    expect(p.view.k).toBe(2);
    advance(300 + 250);
    expect(p.view.k).toBe(3);
    press(64, 600);
    press(65, 700);
    expect(p.view.status).toBe('summary');
    expect(p.view.summary).toMatchObject({ mode: 'wait', total: 4, correct: 3, extra: 1 });
    expect(p.view.xp).toBeGreaterThan(0);
    await p.flush();
    const runs = await repos.scores.runs('score-1');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ mode: 'wait', hands: 'right', bpm: null });
    expect((await repos.scores.get('score-1'))?.lastPlayedAt).not.toBeNull();
    expect((await repos.sessions.recent(1))[0]?.config).toMatchObject({ kind: 'score' });
  });

  it('mutes the other hand and loops; stopping keeps what was played', async () => {
    const p = player();
    await p.start(config({ otherHand: 'mute', loops: null }));
    press(60, 10);
    press(62, 20);
    advance(400);
    press(64, 410);
    press(65, 420);
    expect(played).toEqual([]);
    // 第二遍开始：上一遍的标记清掉
    expect(p.view.k).toBe(5);
    expect(p.view.marks.size).toBe(0);
    press(60, 430);
    expect(p.view.marks.size).toBe(1);
    p.stop();
    expect(p.view.status).toBe('summary');
    expect(p.view.summary?.total).toBe(5);
    expect(silenced).toBe(1);
  });

  it('reports an empty section', async () => {
    const p = player();
    const empty = { ...score, notes: score.notes.filter((n) => n.hand === 'right') };
    await p.start(config({ score: empty, hands: 'left' }));
    expect(p.view).toMatchObject({ status: 'error', error: 'empty' });
  });

  it('keeps going without piano audio', async () => {
    const p = player(true);
    await p.start(config());
    expect(p.view.status).toBe('running');
  });
});

describe('ScorePlayer: tempo mode', () => {
  const tickMs = 500 / TPQ;

  it('counts in, times every note, schedules the other hand and summarizes', async () => {
    const p = player();
    await p.start(config({ mode: 'tempo' }));
    expect(metronomes[0]).toMatchObject({ bpm: 120, countInBeats: 4, click: true });
    expect(p.view.clock).toEqual({ startT: T0, msPerTick: tickMs });
    expect(countInBeatsLeft(p.view, T0 - 1200)).toBe(3);
    expect(countInBeatsLeft(p.view, T0 + 1)).toBeNull();
    expect(playheadTick(p.view, T0 + 250)).toBeCloseTo(TPQ / 2);
    // 预备拍里按的不算
    press(60, T0 - 1500);
    advance(T0 - 1000);
    press(60, T0 + 20); // 在拍上
    press(62, T0 + 500 + 140); // 晚 140 ms
    // E4 漏弹；F4 早 30 ms
    press(65, T0 + 1500 - 30);
    advance(T0 + 4000);
    expect(p.view.status).toBe('summary');
    expect(p.view.summary).toMatchObject({ mode: 'tempo', total: 4, correct: 3, missed: 1 });
    expect(metronomes[0]?.stopped).toBe(true);
    // 左手两个音按时间安排
    expect(played.map((x) => [x.pitches, x.at])).toEqual([
      [[48], T0],
      [[43], T0 + 750],
    ]);
    await p.flush();
    expect((await repos.scores.runs('score-1'))[0]).toMatchObject({ mode: 'tempo', bpm: 120 });
  });

  it('slows down with the speed setting and can run without the metronome', async () => {
    const p = player();
    await p.start(config({ mode: 'tempo', speed: 0.5, metronome: false }));
    expect(metronomes[0]).toMatchObject({ bpm: 60, click: false });
    expect(effectiveBpm(score, 0.1)).toBe(20);
    p.dispose();
    expect(p.view.status).toBe('idle');
    expect(metronomes[0]?.stopped).toBe(true);
  });

  it('listen mode plays both hands and returns to idle', async () => {
    const p = player();
    await p.start(config({ mode: 'listen' }));
    advance(T0 + 2400);
    expect(played.map((x) => x.pitches)).toEqual([[60, 48], [62], [43], [64], [65]]);
    expect(p.view.status).toBe('idle');
  });

  it('listen mode needs audio', async () => {
    const p = player(true);
    await p.start(config({ mode: 'listen' }));
    expect(p.view).toMatchObject({ status: 'error', error: 'audio' });
  });
});
