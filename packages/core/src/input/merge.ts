import type { InputEvent } from './events';

/**
 * 跨通道、跨输入源合并同一个音（引用计数）。
 *
 * 实测：JUNO-D7 的 DUAL 模式会把每个音同时在通道 1 和 2 各发一次（时间戳相同）；
 * 屏幕键盘和 MIDI 键盘也可能同时按住同一个音。合并后：
 * - 某个音第一次被按下时才输出 noteOn，之后的重复按下被吞掉；
 * - 最后一个持有者松开时才输出 noteOff；
 * - 延音踏板同理：任一持有者踩下即为踩下，全部抬起才算抬起。
 * 其他事件原样通过。
 */
export function createNoteMerger(): {
  push: (e: InputEvent) => InputEvent | null;
  /** 某个输入源断开时，释放它持有的所有音，返回需要补发的 noteOff */
  releaseSource: (source: string, t: number) => InputEvent[];
} {
  const holders = new Map<number, Set<string>>();
  const pedalHolders = new Set<string>();
  const holderKey = (e: { source: string; channel: number }) => `${e.source}#${e.channel}`;

  const push = (e: InputEvent): InputEvent | null => {
    switch (e.kind) {
      case 'noteOn': {
        let set = holders.get(e.note);
        if (!set) {
          set = new Set();
          holders.set(e.note, set);
        }
        const first = set.size === 0;
        set.add(holderKey(e));
        return first ? e : null;
      }
      case 'noteOff': {
        const set = holders.get(e.note);
        if (!set?.delete(holderKey(e))) return null;
        if (set.size > 0) return null;
        holders.delete(e.note);
        return e;
      }
      case 'sustain': {
        const before = pedalHolders.size > 0;
        if (e.down) pedalHolders.add(holderKey(e));
        else pedalHolders.delete(holderKey(e));
        const after = pedalHolders.size > 0;
        return before === after ? null : { ...e, down: after };
      }
      default:
        return e;
    }
  };

  const releaseSource = (source: string, t: number): InputEvent[] => {
    const out: InputEvent[] = [];
    const prefix = `${source}#`;
    for (const [note, set] of holders) {
      let channel = 1;
      for (const k of [...set]) {
        if (k.startsWith(prefix)) {
          channel = Number(k.slice(prefix.length));
          set.delete(k);
        }
      }
      if (set.size === 0) {
        holders.delete(note);
        out.push({ kind: 'noteOff', note, velocity: 0, channel, t, source });
      }
    }
    const pedalBefore = pedalHolders.size > 0;
    for (const k of [...pedalHolders]) if (k.startsWith(prefix)) pedalHolders.delete(k);
    if (pedalBefore && pedalHolders.size === 0) {
      out.push({ kind: 'sustain', down: false, value: 0, channel: 1, t, source });
    }
    return out;
  };

  return { push, releaseSource };
}

/**
 * 把音符事件整体移调（用于八度/移调校准：offset 为实测的偏移量，这里减去它）。
 * 移调后超出 0–127 的音符事件被丢弃。
 */
export function shiftNotes(e: InputEvent, semitones: number): InputEvent | null {
  if (semitones === 0) return e;
  if (e.kind !== 'noteOn' && e.kind !== 'noteOff' && e.kind !== 'polyPressure') return e;
  if (e.note === undefined) return e;
  const note = e.note + semitones;
  if (note < 0 || note > 127) return null;
  return { ...e, note };
}
