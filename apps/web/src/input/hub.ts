import type { InputSourceKind } from '@mayochord/core';
import { createNoteMerger, type InputEvent, shiftNotes } from '@mayochord/core';

type Listener = (e: InputEvent) => void;

/** 输入源 ID → 输入源类型（写入作答日志，用于判断齐整度是否有意义）。 */
export function sourceKind(source: string): InputSourceKind {
  if (source.startsWith('webmidi')) return 'midi';
  if (source === 'onscreen') return 'onscreen';
  if (source === 'keyboard') return 'keyboard';
  return 'manual';
}

/**
 * 输入汇流：把 Web MIDI、屏幕键盘、电脑键盘的事件合并成一条统一的事件流。
 * - MIDI 事件先扣除八度/移调校准的偏移（只对 MIDI 生效）；
 * - 再按音符号跨通道、跨输入源合并（JUNO-D7 的 DUAL 模式会在通道 1、2 重复发同一个音）；
 * - 输入源断开、校准偏移变化时补发 noteOff，避免音“卡住”。
 */
export class InputHub {
  private merger = createNoteMerger();
  private listeners = new Set<Listener>();
  private midiOffset = 0;
  private midiSources = new Set<string>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 设置 MIDI 校准偏移（按中央 C 收到的音符号 - 60）。会先释放所有 MIDI 音。 */
  setMidiOffset(offset: number, now = performance.now()) {
    if (offset === this.midiOffset) return;
    for (const s of this.midiSources) this.releaseSource(s, now);
    this.midiOffset = offset;
  }

  get offset(): number {
    return this.midiOffset;
  }

  /** 输入源送入一个原始事件。 */
  ingest(e: InputEvent) {
    let event: InputEvent | null = e;
    if (sourceKind(e.source) === 'midi') {
      this.midiSources.add(e.source);
      event = shiftNotes(e, -this.midiOffset);
    }
    if (!event) return;
    const merged = this.merger.push(event);
    if (merged) this.emit(merged);
  }

  /** 某个输入源断开或失焦：释放它持有的所有音。 */
  releaseSource(source: string, now = performance.now()) {
    for (const e of this.merger.releaseSource(source, now)) this.emit(e);
  }

  private emit(e: InputEvent) {
    for (const l of this.listeners) l(e);
  }
}

export const inputHub = new InputHub();
