import { describe, expect, it } from 'vitest';
import type { InputEvent } from './events';
import { createNoteMerger, shiftNotes } from './merge';

const ev = (
  kind: 'noteOn' | 'noteOff',
  note: number,
  channel = 1,
  source = 'midi',
  t = 0,
): InputEvent => ({ kind, note, velocity: kind === 'noteOn' ? 80 : 0, channel, t, source });

describe('createNoteMerger', () => {
  it('JUNO-D7 DUAL：同一个音在通道 1、2 各发一次，只输出一次', () => {
    const m = createNoteMerger();
    expect(m.push(ev('noteOn', 60, 1))).not.toBeNull();
    expect(m.push(ev('noteOn', 60, 2))).toBeNull();
    expect(m.push(ev('noteOff', 60, 1))).toBeNull();
    expect(m.push(ev('noteOff', 60, 2))).toMatchObject({ kind: 'noteOff', note: 60 });
  });

  it('不同输入源同时按住同一个音', () => {
    const m = createNoteMerger();
    m.push(ev('noteOn', 64, 1, 'midi'));
    expect(m.push(ev('noteOn', 64, 1, 'onscreen'))).toBeNull();
    expect(m.push(ev('noteOff', 64, 1, 'midi'))).toBeNull();
    expect(m.push(ev('noteOff', 64, 1, 'onscreen'))).not.toBeNull();
  });

  it('没有按下过的音的 noteOff 被丢弃', () => {
    const m = createNoteMerger();
    expect(m.push(ev('noteOff', 61))).toBeNull();
  });

  it('延音踏板：任一持有者踩下即踩下，全部抬起才抬起', () => {
    const m = createNoteMerger();
    const pedal = (down: boolean, channel: number): InputEvent => ({
      kind: 'sustain',
      down,
      value: down ? 127 : 0,
      channel,
      t: 0,
      source: 'midi',
    });
    expect(m.push(pedal(true, 1))).toMatchObject({ down: true });
    expect(m.push(pedal(true, 2))).toBeNull();
    expect(m.push(pedal(false, 1))).toBeNull();
    expect(m.push(pedal(false, 2))).toMatchObject({ down: false });
  });

  it('其他事件原样通过', () => {
    const m = createNoteMerger();
    const clock: InputEvent = { kind: 'clock', t: 0, source: 'midi' };
    expect(m.push(clock)).toBe(clock);
  });

  it('输入源断开时补发 noteOff 与踏板抬起', () => {
    const m = createNoteMerger();
    m.push(ev('noteOn', 60, 1, 'midi'));
    m.push(ev('noteOn', 62, 2, 'midi'));
    m.push(ev('noteOn', 64, 1, 'onscreen'));
    m.push(ev('noteOn', 64, 1, 'midi'));
    m.push({ kind: 'sustain', down: true, value: 127, channel: 1, t: 0, source: 'midi' });
    const released = m.releaseSource('midi', 99);
    expect(released).toEqual([
      { kind: 'noteOff', note: 60, velocity: 0, channel: 1, t: 99, source: 'midi' },
      { kind: 'noteOff', note: 62, velocity: 0, channel: 2, t: 99, source: 'midi' },
      { kind: 'sustain', down: false, value: 0, channel: 1, t: 99, source: 'midi' },
    ]);
    // 64 仍由屏幕键盘持有
    expect(m.push(ev('noteOff', 64, 1, 'onscreen'))).not.toBeNull();
    expect(m.releaseSource('midi', 100)).toEqual([]);
  });
});

describe('shiftNotes', () => {
  it('整体移调，超出范围的丢弃，非音符事件原样返回', () => {
    expect(shiftNotes(ev('noteOn', 72), -12)).toMatchObject({ note: 60 });
    expect(shiftNotes(ev('noteOn', 5), -12)).toBeNull();
    expect(shiftNotes(ev('noteOff', 120), 12)).toBeNull();
    const e = ev('noteOn', 60);
    expect(shiftNotes(e, 0)).toBe(e);
    const pedal: InputEvent = {
      kind: 'sustain',
      down: true,
      value: 127,
      channel: 1,
      t: 0,
      source: 'midi',
    };
    expect(shiftNotes(pedal, 12)).toBe(pedal);
    const pp: InputEvent = {
      kind: 'polyPressure',
      note: 60,
      value: 3,
      channel: 1,
      t: 0,
      source: 'm',
    };
    expect(shiftNotes(pp, 12)).toMatchObject({ note: 72 });
    const cp: InputEvent = { kind: 'channelPressure', value: 3, channel: 1, t: 0, source: 'm' };
    expect(shiftNotes(cp, 12)).toBe(cp);
  });
});
