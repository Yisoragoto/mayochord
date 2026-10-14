import { describe, expect, it } from 'vitest';
import { midiBytesToHex, parseMidiMessage } from './midi';

const p = (bytes: number[]) => parseMidiMessage(bytes, 100, 'test');

describe('parseMidiMessage', () => {
  it('解析 note on / note off，通道从 1 开始', () => {
    expect(p([0x90, 60, 100])).toEqual({
      kind: 'noteOn',
      note: 60,
      velocity: 100,
      channel: 1,
      t: 100,
      source: 'test',
    });
    expect(p([0x8f, 60, 40])).toMatchObject({
      kind: 'noteOff',
      note: 60,
      velocity: 40,
      channel: 16,
    });
  });

  it('velocity=0 的 note on 视为 note off', () => {
    expect(p([0x93, 64, 0])).toMatchObject({ kind: 'noteOff', note: 64, velocity: 0, channel: 4 });
  });

  it('CC64 解析为延音踏板，>=64 为踩下', () => {
    expect(p([0xb0, 64, 127])).toMatchObject({ kind: 'sustain', down: true, value: 127 });
    expect(p([0xb0, 64, 63])).toMatchObject({ kind: 'sustain', down: false, value: 63 });
    expect(p([0xb0, 64, 64])).toMatchObject({ kind: 'sustain', down: true });
  });

  it('其他 CC 保留控制器号', () => {
    expect(p([0xb1, 7, 90])).toMatchObject({ kind: 'cc', controller: 7, value: 90, channel: 2 });
  });

  it('音色切换、弯音、触后', () => {
    expect(p([0xc0, 5])).toMatchObject({ kind: 'programChange', value: 5 });
    expect(p([0xe0, 0x00, 0x40])).toMatchObject({ kind: 'pitchBend', value: 0 });
    expect(p([0xe0, 0x7f, 0x7f])).toMatchObject({ kind: 'pitchBend', value: 8191 });
    expect(p([0xe0, 0x00, 0x00])).toMatchObject({ kind: 'pitchBend', value: -8192 });
    expect(p([0xd0, 70])).toMatchObject({ kind: 'channelPressure', value: 70 });
    expect(p([0xa0, 60, 30])).toMatchObject({ kind: 'polyPressure', note: 60, value: 30 });
  });

  it('系统实时消息：保留 clock/start/stop/continue，忽略 active sensing', () => {
    expect(p([0xf8])).toMatchObject({ kind: 'clock' });
    expect(p([0xfa])).toMatchObject({ kind: 'start' });
    expect(p([0xfb])).toMatchObject({ kind: 'continue' });
    expect(p([0xfc])).toMatchObject({ kind: 'stop' });
    expect(p([0xfe])).toBeNull();
    expect(p([0xff])).toBeNull();
    expect(p([0xf0, 0x41, 0xf7])).toBeNull();
  });

  it('空消息与未知状态字节返回 null', () => {
    expect(p([])).toBeNull();
    expect(p([0x30, 1, 2])).toBeNull();
  });

  it('缺失数据字节按 0 处理', () => {
    expect(p([0x90, 60])).toMatchObject({ kind: 'noteOff', note: 60 });
  });
});

describe('midiBytesToHex', () => {
  it('格式化为大写两位十六进制', () => {
    expect(midiBytesToHex([0x90, 0x3c, 0x7])).toBe('90 3C 07');
  });
});
