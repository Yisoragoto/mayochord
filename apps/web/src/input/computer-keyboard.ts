import type { InputEvent } from '@mayochord/core';
import { create } from 'zustand';
import type { InputHub } from './hub';

/** 电脑键盘当前的最低音（A 键），用于在界面上显示八度和键位提示 */
export const useComputerKeyboard = create<{ base: number }>()(() => ({ base: 60 }));

/**
 * 电脑键盘弹奏（与常见 DAW 的布局一致，按物理键位 event.code，与键盘布局无关）：
 *   白键  A S D F G H J K L ;  → C D E F G A B C D E
 *   黑键  W E   T Y U   O P    → C♯ D♯  F♯ G♯ A♯  C♯ D♯
 *   Z / X 降低 / 升高一个八度
 * 输入框里打字、按着 Ctrl/⌘/Alt 时不触发。
 */
export const KEY_TO_OFFSET: Readonly<Record<string, number>> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
};

/** 键位提示用：偏移 → 键帽上的字母 */
export const OFFSET_TO_LABEL: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(KEY_TO_OFFSET).map(([code, off]) => [
    off,
    code === 'Semicolon' ? ';' : code.replace('Key', ''),
  ]),
);

export const MIN_BASE = 24;
export const MAX_BASE = 96;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset'].includes(type);
  }
  return false;
}

export interface ComputerKeyboardOptions {
  enabled: () => boolean;
  /** 最低键（A）对应的 MIDI 号，默认 C4 = 60 */
  base?: number;
  onBaseChange?: (base: number) => void;
}

/** 在 window 上监听键盘并把事件送进输入汇流。返回停止函数。 */
export function startComputerKeyboard(hub: InputHub, opts: ComputerKeyboardOptions): () => void {
  let base = opts.base ?? 60;
  const down = new Map<string, number>();
  const SOURCE = 'keyboard';

  const emit = (kind: 'noteOn' | 'noteOff', note: number, t: number) => {
    const e: InputEvent =
      kind === 'noteOn'
        ? { kind, note, velocity: 80, channel: 1, t, source: SOURCE }
        : { kind, note, velocity: 0, channel: 1, t, source: SOURCE };
    hub.ingest(e);
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (!opts.enabled() || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing) return;
    if (isTypingTarget(ev.target)) return;
    if (ev.code === 'KeyZ' || ev.code === 'KeyX') {
      if (ev.repeat) return;
      const next = Math.min(MAX_BASE, Math.max(MIN_BASE, base + (ev.code === 'KeyZ' ? -12 : 12)));
      if (next !== base) {
        hub.releaseSource(SOURCE, ev.timeStamp);
        down.clear();
        base = next;
        opts.onBaseChange?.(base);
      }
      ev.preventDefault();
      return;
    }
    const offset = KEY_TO_OFFSET[ev.code];
    if (offset === undefined) return;
    ev.preventDefault();
    if (ev.repeat || down.has(ev.code)) return;
    const note = base + offset;
    down.set(ev.code, note);
    emit('noteOn', note, ev.timeStamp);
  };

  const onKeyUp = (ev: KeyboardEvent) => {
    const note = down.get(ev.code);
    if (note === undefined) return;
    down.delete(ev.code);
    emit('noteOff', note, ev.timeStamp);
  };

  const releaseAll = () => {
    if (down.size === 0) return;
    down.clear();
    hub.releaseSource(SOURCE, performance.now());
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', releaseAll);
    releaseAll();
  };
}
