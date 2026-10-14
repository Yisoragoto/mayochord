import type { InputEvent, SourceId } from './events';

/**
 * 把一条完整的 MIDI 消息（Web MIDI 每次回调给出一条完整消息，不含 running status）解析成 InputEvent。
 * 返回 null 表示应忽略的消息：active sensing、system reset、sysex、MTC 等。
 */
export function parseMidiMessage(
  data: ArrayLike<number>,
  t: number,
  source: SourceId,
): InputEvent | null {
  const status = data[0];
  if (status === undefined) return null;

  if (status >= 0xf0) {
    switch (status) {
      case 0xf8:
        return { kind: 'clock', t, source };
      case 0xfa:
        return { kind: 'start', t, source };
      case 0xfb:
        return { kind: 'continue', t, source };
      case 0xfc:
        return { kind: 'stop', t, source };
      default:
        // 0xFE active sensing、0xFF reset、0xF0 sysex 等全部忽略
        return null;
    }
  }

  const type = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const d1 = (data[1] ?? 0) & 0x7f;
  const d2 = (data[2] ?? 0) & 0x7f;

  switch (type) {
    case 0x80:
      return { kind: 'noteOff', note: d1, velocity: d2, channel, t, source };
    case 0x90:
      // velocity = 0 的 note on 视为 note off
      return d2 === 0
        ? { kind: 'noteOff', note: d1, velocity: 0, channel, t, source }
        : { kind: 'noteOn', note: d1, velocity: d2, channel, t, source };
    case 0xa0:
      return { kind: 'polyPressure', note: d1, value: d2, channel, t, source };
    case 0xb0:
      return d1 === 64
        ? { kind: 'sustain', down: d2 >= 64, value: d2, channel, t, source }
        : { kind: 'cc', controller: d1, value: d2, channel, t, source };
    case 0xc0:
      return { kind: 'programChange', value: d1, channel, t, source };
    case 0xd0:
      return { kind: 'channelPressure', value: d1, channel, t, source };
    case 0xe0:
      return { kind: 'pitchBend', value: ((d2 << 7) | d1) - 8192, channel, t, source };
    default:
      return null;
  }
}

/** 用于日志显示的十六进制字符串，如 "90 3C 64"。 */
export function midiBytesToHex(data: ArrayLike<number>): string {
  return Array.from(data, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}
