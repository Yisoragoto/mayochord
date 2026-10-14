import type { InputHub } from '@/input/hub';
import { sourceKind } from '@/input/hub';
import { getPiano, readyPiano } from './piano';

/**
 * 屏幕键盘、电脑键盘弹奏时由网页发声。MIDI 键盘自己会发声，这里不处理。
 * 第一次弹奏时开始加载音源（那一下可能没有声音，加载完成后正常）。
 */
export function startLiveSound(hub: InputHub, enabled: () => boolean): () => void {
  return hub.subscribe((e) => {
    if (e.kind !== 'noteOn' && e.kind !== 'noteOff') return;
    const kind = sourceKind(e.source);
    if (kind !== 'onscreen' && kind !== 'keyboard') return;
    if (!enabled()) return;
    const piano = readyPiano();
    if (!piano) {
      if (e.kind === 'noteOn') void getPiano().catch(() => {});
      return;
    }
    if (e.kind === 'noteOn') piano.noteOn(e.note, e.velocity);
    else piano.noteOff(e.note);
  });
}
