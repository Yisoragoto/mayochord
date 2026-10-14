import { describe, expect, it } from 'vitest';
import type { ChordAttempt } from '../recognition/attempt';
import {
  adaptBpm,
  gradeRunEvidence,
  type RunEvidence,
  type RunSpec,
  type RunState,
  runAttempt,
  runCardIds,
  runEndT,
  runPassed,
  runTick,
  scheduleStep,
  startRun,
  stepClean,
  stepEvidence,
  stopRun,
  summarizeRun,
  totalSteps,
} from './progression-run';

const C = [48, 60, 64, 67];
const G = [43, 59, 62, 67];

const spec = (over: Partial<RunSpec> = {}): RunSpec => ({
  steps: [
    { chordId: 'c', target: C, slash: false, beats: 2, anticipation: 0 },
    { chordId: 'g', target: G, slash: false, beats: 2, anticipation: 0 },
  ],
  loops: 2,
  bpm: 120, // 每拍 500 ms
  beatsPerBar: 4,
  countInBeats: 4,
  voicingMode: 'any',
  hintsVisible: false,
  latencyMs: 0,
  onsetWindowMs: 80,
  ...over,
});

/** 一次尝试：notes 全部是新按下的音，按下时间从 t 起每个音隔 spread/(n-1) */
function att(notes: number[], t: number, spread = 20, newNotes = notes): ChordAttempt {
  const onsets: Record<number, number> = {};
  const sources: Record<number, string> = {};
  newNotes.forEach((n, i) => {
    onsets[n] = newNotes.length > 1 ? t + (spread * i) / (newNotes.length - 1) - spread / 2 : t;
    sources[n] = 'webmidi:x';
  });
  for (const n of notes) {
    onsets[n] ??= t - 2000;
    sources[n] ??= 'webmidi:x';
  }
  return {
    notes: [...notes].sort((a, b) => a - b),
    newNotes,
    onsets,
    sources,
    firstOnset: t - spread / 2,
    lastOnset: t + spread / 2,
    spreadMs: spread,
    together: spread <= 80,
    stableAt: t + 150,
  };
}

const T0 = 10_000;

describe('进行练习：排程', () => {
  it('每步的时刻、窗口、"从"和弦；先行切分提前 16 分音符', () => {
    const s = spec();
    const st = startRun(s, T0);
    expect(totalSteps(s)).toBe(4);
    expect(totalSteps(spec({ loops: null }))).toBeNull();
    expect(scheduleStep(s, st.grid, 0)).toMatchObject({
      t: 10_000,
      windowStart: 9750,
      fromChordId: null,
      loop: 0,
    });
    expect(scheduleStep(s, st.grid, 3)).toMatchObject({
      t: 13_000,
      windowStart: 12_750,
      chordId: 'g',
      fromChordId: 'c',
      loop: 1,
      stepIndex: 1,
      beat: 6,
    });
    expect(runEndT(s, st.grid)).toBe(14_000);
    expect(runEndT(spec({ loops: null }), st.grid)).toBeNull();

    // 先行切分：G 提前一个 16 分音符（125 ms）；第一遍第一个和弦不提前
    const ant = spec({
      steps: [
        { chordId: 'c', target: C, slash: false, beats: 2, anticipation: 1 },
        { chordId: 'g', target: G, slash: false, beats: 2, anticipation: 1 },
      ],
    });
    expect(scheduleStep(ant, st.grid, 0).t).toBe(10_000);
    expect(scheduleStep(ant, st.grid, 1).t).toBe(10_875);
    expect(scheduleStep(ant, st.grid, 2).t).toBe(11_875);
  });
});

describe('进行练习：判定', () => {
  it('在拍上弹对；节拍偏差扣除延迟校准；晚了不在拍上', () => {
    let st = startRun(spec({ latencyMs: 30 }), T0);
    st = runAttempt(st, att(C, 10_040), 'midi'); // 扣掉 30 → +10
    st = runAttempt(st, att(G, 11_150, 20, [43, 59, 62]), 'midi'); // +120，不在拍上
    expect(st.results.map((r) => [r.status, r.beatOffsetMs, r.onBeat])).toEqual([
      ['correct', 10, true],
      ['correct', 120, false],
    ]);
    expect(st.open).toBe(2);
  });

  it('预备拍里按的不算；没弹的步窗口结束后记为漏弹；全部结束 finished', () => {
    let st = startRun(spec(), T0);
    st = runAttempt(st, att(C, 9000), 'midi');
    expect(st.results).toHaveLength(0);
    st = runTick(st, 10_500);
    expect(st.results).toHaveLength(0);
    st = runTick(st, 10_760);
    expect(st.results.map((r) => r.status)).toEqual(['missed']);
    // 直接弹第 3 步：第 2 步漏弹
    st = runAttempt(st, att(C, 12_010), 'midi');
    expect(st.results.map((r) => r.status)).toEqual(['missed', 'missed', 'correct']);
    st = runTick(st, 14_000);
    expect(st.results.map((r) => r.status)).toEqual(['missed', 'missed', 'correct', 'missed']);
    expect(st.finished).toBe(true);
    expect(runAttempt(st, att(G, 14_100), 'midi')).toBe(st);
    expect(runTick(st, 20_000)).toBe(st);
  });

  it('只按了一部分：等补全；没补全就判错；弹错之后改对记 corrected', () => {
    let st = startRun(spec(), T0);
    st = runAttempt(st, att([48, 60, 64], 10_000), 'midi');
    expect(st.partial).not.toBeNull();
    st = runAttempt(st, att(C, 10_100, 10, [67]), 'midi');
    expect(st.results[0]).toMatchObject({ status: 'correct', beatOffsetMs: 100 });
    // 第 2 步只按了一部分就到了第 3 步
    st = runAttempt(st, att([43, 59], 11_000), 'midi');
    st = runTick(st, 11_760);
    expect(st.results[1]).toMatchObject({ status: 'wrong' });
    expect(st.results[1]?.judge?.missing).toEqual([62]);
    // 第 3 步弹错（多按），随后改对
    st = runAttempt(st, att([48, 60, 63, 67], 12_000), 'midi');
    expect(st.results[2]).toMatchObject({ status: 'wrong', corrected: false });
    st = runAttempt(st, att(C, 12_200, 10, [64]), 'midi');
    expect(st.results[2]).toMatchObject({ status: 'wrong', corrected: true });
    // 已经改对的步再弹一次：不变
    const before = st;
    st = runAttempt(st, att(C, 12_220, 10, [60]), 'midi');
    expect(st).toBe(before);
    // 更早的步的尝试：忽略
    expect(runAttempt(st, att(C, 10_000), 'midi')).toBe(st);
    // 没有新按下的音：忽略
    expect(runAttempt(st, att(C, 12_300, 0, []), 'midi')).toBe(st);
  });

  it('严格模式比较八度；斜杠和弦要求最低音；屏幕键盘不记齐整度', () => {
    let st = startRun(spec({ voicingMode: 'reference' }), T0);
    st = runAttempt(st, att([48, 52, 55], 10_000), 'midi');
    expect(st.results[0]?.status).toBe('wrong');

    const slash = spec({
      steps: [
        { chordId: 'c-on-e', target: [52, 64, 67, 72], slash: true, beats: 4, anticipation: 0 },
      ],
      loops: 1,
    });
    let s2 = startRun(slash, T0);
    s2 = runAttempt(s2, att([48, 64, 67], 10_000), 'onscreen');
    expect(s2.results[0]).toMatchObject({
      status: 'wrong',
      spreadMs: null,
      together: null,
      inputSource: 'onscreen',
    });
    expect(s2.results[0]?.judge?.wrongBass).toBe(true);
    expect(s2.finished).toBe(true);
  });

  it('无限循环：一直往后排；手动结束', () => {
    let st: RunState = startRun(spec({ loops: null }), T0);
    for (let k = 0; k < 10; k++) {
      st = runAttempt(st, att(k % 2 ? G : C, T0 + k * 1000), 'midi');
    }
    expect(st.results).toHaveLength(10);
    expect(st.finished).toBe(false);
    st = runAttempt(st, att([48, 60, 64], T0 + 10_000), 'midi');
    const stopped = stopRun(st);
    expect(stopped).toMatchObject({ finished: true, partial: null });
    expect(stopped.results).toHaveLength(10);
  });
});

describe('证据、评分、总结', () => {
  it('每步记和弦卡 + 切换卡；评分', () => {
    let st = startRun(spec({ hintsVisible: false }), T0);
    st = runAttempt(st, att(C, 10_000), 'midi');
    st = runAttempt(st, att(G, 11_000, 120), 'midi');
    const [first, second] = st.results;
    const e0 = stepEvidence(st.spec, first as never);
    expect(e0.map((e) => e.cardId)).toEqual(['chord:c:name:any']);
    const e1 = stepEvidence(st.spec, second as never);
    expect(e1.map((e) => e.cardId)).toEqual(['chord:g:name:any', 'transition:c>g:any']);
    expect(e1[0]).toMatchObject({ together: false, drillType: 'progression', beatOffsetMs: 0 });
    expect(gradeRunEvidence(e0[0] as never)).toBe(3);
    expect(gradeRunEvidence(e1[0] as never)).toBe(2);
    const base = e0[0] as RunEvidence;
    expect(gradeRunEvidence({ ...base, hintUsed: true })).toBe(2);
    expect(gradeRunEvidence({ ...base, correct: false })).toBe(1);
    expect(stepClean(first as never)).toBe(true);
    expect(stepClean(second as never)).toBe(false);
  });

  it('runCardIds：和弦卡 + 循环里的切换卡', () => {
    expect(runCardIds(spec())).toEqual([
      'chord:c:name:any',
      'transition:g>c:any',
      'chord:g:name:any',
      'transition:c>g:any',
    ]);
    expect(runCardIds(spec({ loops: 1 }))).toEqual([
      'chord:c:name:any',
      'chord:g:name:any',
      'transition:c>g:any',
    ]);
  });

  it('summarizeRun / runPassed', () => {
    let st = startRun(spec(), T0);
    st = runAttempt(st, att(C, 10_020), 'midi');
    st = runAttempt(st, att(G, 10_960), 'midi');
    st = runAttempt(st, att(C, 12_030), 'midi');
    st = runTick(st, 14_000);
    const s = summarizeRun(st.results);
    expect(s).toMatchObject({
      total: 4,
      correct: 3,
      missed: 1,
      accuracy: 0.75,
      cleanRate: 0.75,
      onBeatRate: 1,
      meanOffsetMs: 3,
      notTogether: 0,
      meanSpreadMs: 20,
    });
    expect(s.stdevOffsetMs).toBe(31);
    expect(s.chords.find((c) => c.chordId === 'g')).toMatchObject({ total: 2, correct: 1 });
    expect(s.transitions.find((t) => t.from === 'g' && t.to === 'c')).toMatchObject({
      total: 1,
      clean: 1,
    });
    expect(s.histogram.reduce((n, b) => n + b.count, 0)).toBe(3);
    expect(runPassed(s, 0.7)).toBe(false); // 有漏弹
    expect(runPassed({ ...s, missed: 0 }, 0.7)).toBe(true);
    expect(runPassed(summarizeRun([]), 0)).toBe(false);
    expect(summarizeRun([])).toMatchObject({ cleanRate: 0, onBeatRate: null, stdevOffsetMs: null });
  });

  it('adaptBpm：85% 规则', () => {
    const many = (n: number, ok: number) => Array.from({ length: n }, (_, i) => i < ok);
    expect(adaptBpm(80, many(5, 5))).toEqual({ bpm: 80, change: null });
    expect(adaptBpm(80, many(20, 19))).toEqual({ bpm: 84, change: 'faster' });
    expect(adaptBpm(80, many(20, 12))).toEqual({ bpm: 72, change: 'slower' });
    expect(adaptBpm(80, many(20, 17))).toEqual({ bpm: 80, change: null });
    expect(adaptBpm(200, many(20, 20))).toEqual({ bpm: 200, change: null });
    expect(adaptBpm(40, many(20, 0))).toEqual({ bpm: 40, change: null });
  });
});
