import { describe, expect, it } from 'vitest';
import type { InputEvent } from '../input/events';
import { AttemptTracker, DEFAULT_ATTEMPT_OPTIONS, findAttempts } from './attempt';
import { findUniformShift, judgeNotes } from './judge';

const on = (note: number, t: number): InputEvent => ({
  kind: 'noteOn',
  note,
  velocity: 80,
  channel: 1,
  t,
  source: 's',
});
const off = (note: number, t: number): InputEvent => ({
  kind: 'noteOff',
  note,
  velocity: 0,
  channel: 1,
  t,
  source: 's',
});

describe('judgeNotes', () => {
  // Am7 参考键位：A3 + G4 C5 E5
  const am7 = [57, 67, 72, 76];

  it('严格模式：逐音一致', () => {
    expect(judgeNotes([57, 67, 72, 76], am7, 'strict')).toEqual({
      correct: true,
      extra: [],
      missing: [],
    });
    expect(judgeNotes([57, 67, 73, 76], am7, 'strict')).toEqual({
      correct: false,
      extra: [73],
      missing: [72],
    });
    // 换了八度也不算对
    expect(judgeNotes([45, 67, 72, 76], am7, 'strict').correct).toBe(false);
  });

  it('宽松模式：只比较音级，忽略八度和转位', () => {
    expect(judgeNotes([45, 60, 64, 67], am7, 'loose').correct).toBe(true);
    expect(judgeNotes([57, 60, 64, 67, 69], am7, 'loose').correct).toBe(true);
    const r = judgeNotes([57, 60, 64, 66], am7, 'loose');
    expect(r.correct).toBe(false);
    expect(r.extra).toEqual([66]);
    expect(r.missing).toEqual([67]);
  });

  it('什么都没按不算对', () => {
    expect(judgeNotes([], [], 'loose').correct).toBe(false);
    expect(judgeNotes([], [], 'strict').correct).toBe(false);
    expect(judgeNotes([], am7, 'loose').missing).toEqual(am7);
  });
});

describe('AttemptTracker', () => {
  it('默认阈值：80ms 窗口、150ms 稳定', () => {
    expect(DEFAULT_ATTEMPT_OPTIONS).toEqual({
      onsetWindowMs: 80,
      stableMs: 150,
      sustainCountsAsHeld: false,
    });
  });

  it('和弦的音在窗口内落下，保持 150ms 后产生一次尝试', () => {
    const tr = new AttemptTracker();
    expect(tr.push(on(60, 1000))).toBeNull();
    expect(tr.push(on(64, 1020))).toBeNull();
    expect(tr.push(on(67, 1040))).toBeNull();
    expect(tr.poll(1100)).toBeNull();
    expect(tr.msUntilStable(1100)).toBe(90);
    const a = tr.poll(1190);
    expect(a).toMatchObject({
      notes: [60, 64, 67],
      newNotes: [60, 64, 67],
      firstOnset: 1000,
      lastOnset: 1040,
      spreadMs: 40,
      together: true,
      stableAt: 1190,
    });
    // 同一个稳定状态只产生一次
    expect(tr.poll(2000)).toBeNull();
    expect(tr.msUntilStable(2000)).toBeNull();
  });

  it('齐整度超过窗口时 together = false', () => {
    const [a] = findAttempts([on(60, 0), on(64, 50), on(67, 120)], {}, 400);
    expect(a?.spreadMs).toBe(120);
    expect(a?.together).toBe(false);
  });

  it('下一个事件到来时，若前一个状态已稳定则先返回它', () => {
    const tr = new AttemptTracker();
    tr.push(on(60, 0));
    tr.push(on(64, 10));
    const a = tr.push(off(60, 500));
    expect(a?.notes).toEqual([60, 64]);
  });

  it('只松开手指不算新的尝试', () => {
    const attempts = findAttempts([on(60, 0), on(64, 0), on(67, 0), off(64, 400)], {}, 1000);
    expect(attempts).toHaveLength(1);
  });

  it('保持共同音换和弦：齐整度只算新按下的音', () => {
    // Dm7 右手 F4 A4 C5 → G7 右手 F4 G4 B4（F4 一直按着）
    const events = [
      on(65, 0),
      on(69, 5),
      on(72, 10),
      off(69, 1000),
      off(72, 1002),
      on(67, 1030),
      on(71, 1045),
    ];
    const attempts = findAttempts(events, {}, 2000);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toMatchObject({
      notes: [65, 67, 71],
      newNotes: [67, 71],
      spreadMs: 15,
      together: true,
    });
  });

  it('按得太短：按下的音在稳定前都松开了 → 没有尝试，记一次 shortTap', () => {
    const tr = new AttemptTracker();
    tr.push(on(60, 0));
    tr.push(off(60, 80));
    expect(tr.poll(300)).toBeNull();
    expect(tr.takeShortTap()).toEqual({ notes: [60], t: 300 });
    expect(tr.takeShortTap()).toBeNull();
    // 按稳了再松开：正常的尝试，不是太短
    tr.push(on(62, 1000));
    expect(tr.push(off(62, 1300))?.notes).toEqual([62]);
    expect(tr.poll(2000)).toBeNull();
    expect(tr.takeShortTap()).toBeNull();
    // 按住和弦时短按一个音：也算太短
    tr.push(on(64, 3000));
    tr.poll(3200);
    tr.push(on(67, 3300));
    tr.push(off(67, 3350));
    tr.poll(3600);
    expect(tr.takeShortTap()?.notes).toEqual([67]);
    tr.push(on(65, 4000));
    tr.push(off(65, 4010));
    tr.reset();
    expect(tr.poll(5000)).toBeNull();
    expect(tr.takeShortTap()).toBeNull();
  });

  it('快速改正：按错的音在稳定前松开，按最终状态判定', () => {
    const attempts = findAttempts([on(60, 0), on(63, 10), off(63, 60), on(64, 70)], {}, 500);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.notes).toEqual([60, 64]);
  });

  it('可调阈值与踏板选项', () => {
    const pedal = (down: boolean, t: number): InputEvent => ({
      kind: 'sustain',
      down,
      value: down ? 127 : 0,
      channel: 1,
      t,
      source: 's',
    });
    const events = [pedal(true, 0), on(60, 10), on(64, 20), off(60, 100), off(64, 100)];
    expect(findAttempts(events, { stableMs: 50 }, 400)).toHaveLength(1);
    const held = findAttempts(events, { sustainCountsAsHeld: true }, 400);
    expect(held.at(-1)?.notes).toEqual([60, 64]);
    const tr = new AttemptTracker({ sustainCountsAsHeld: true });
    for (const e of events) tr.push(e);
    expect(tr.heldNotes()).toEqual([60, 64]);
    expect(tr.held.sustainDown).toBe(true);
    tr.reset();
    expect(tr.heldNotes()).toEqual([]);
    expect(tr.poll(10_000)).toBeNull();
  });

  it('没有结束时间时不检查最后一个状态', () => {
    expect(findAttempts([on(60, 0), on(64, 0), on(67, 0)])).toEqual([]);
  });
});

describe('findUniformShift', () => {
  const am7 = [57, 67, 72, 76];
  it('整体高一个八度、整体移调', () => {
    expect(findUniformShift([69, 79, 84, 88], am7)).toBe(12);
    expect(findUniformShift([59, 69, 74, 78], am7)).toBe(2);
    expect(findUniformShift([45, 55, 60, 64], am7)).toBe(-12);
  });
  it('不是整体平移、没有平移、超出范围或音数不同时返回 null', () => {
    expect(findUniformShift([69, 79, 84, 89], am7)).toBeNull();
    expect(findUniformShift(am7, am7)).toBeNull();
    expect(findUniformShift([105, 115, 120, 124], am7)).toBeNull();
    expect(findUniformShift([69, 79], am7)).toBeNull();
    expect(findUniformShift([], [])).toBeNull();
  });
});
