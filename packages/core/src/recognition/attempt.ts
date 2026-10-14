import type { InputEvent } from '../input/events';
import { applyHeldEvent, EMPTY_HELD_STATE, type HeldState, heldNoteNumbers } from './held-notes';

export interface AttemptOptions {
  /** 同一和弦的音应在多长时间内全部按下（毫秒），默认 80 */
  onsetWindowMs: number;
  /** 按住的音保持多久不变才算"弹出了一个和弦"（毫秒），默认 150 */
  stableMs: number;
  /** 踩踏板时松开的音是否仍算按住 */
  sustainCountsAsHeld: boolean;
}

export const DEFAULT_ATTEMPT_OPTIONS: AttemptOptions = {
  onsetWindowMs: 80,
  stableMs: 150,
  sustainCountsAsHeld: false,
};

/** 一次"弹出和弦"的尝试：按住的音保持稳定 stableMs 之后产生。 */
export interface ChordAttempt {
  /** 稳定时按住的全部音（升序） */
  notes: number[];
  /** 这一次动作里新按下的音（不含从上一个和弦保持下来的共同音） */
  newNotes: number[];
  /** notes 中每个音的按下时间 */
  onsets: Record<number, number>;
  /** notes 中每个音来自哪个输入源 */
  sources: Record<number, string>;
  /** 新按下的音里最早、最晚的按下时间 */
  firstOnset: number;
  lastOnset: number;
  /** 齐整度：lastOnset - firstOnset */
  spreadMs: number;
  /** 齐整度是否在 onsetWindowMs 以内 */
  together: boolean;
  /** 判定为稳定的时刻（最后一次变化 + stableMs） */
  stableAt: number;
}

/**
 * 流式检测"弹出一个和弦"。不使用定时器：调用方每收到一个事件就 push，
 * 并定期（例如每帧）用当前时间 poll。所有时间都是 performance.now() 域。
 *
 * 规则：
 * - 按住的音集合发生变化后，如果在 stableMs 内不再变化，就产生一次尝试；
 * - 只有这次动作里有新按下的音才算尝试（只松开手指不算）；
 * - 同一个稳定状态只产生一次尝试。
 */
export class AttemptTracker {
  private state: HeldState = EMPTY_HELD_STATE;
  private heldKey = '';
  private lastChange: number | null = null;
  private gestureStart: number | null = null;
  private settled = true;
  private readonly opts: AttemptOptions;

  constructor(opts: Partial<AttemptOptions> = {}) {
    this.opts = { ...DEFAULT_ATTEMPT_OPTIONS, ...opts };
  }

  get held(): HeldState {
    return this.state;
  }

  heldNotes(): number[] {
    return heldNoteNumbers(this.state, { sustainCountsAsHeld: this.opts.sustainCountsAsHeld });
  }

  /** 处理一个事件。如果此前的状态在事件到来前已经稳定，先返回那次尝试。 */
  push(e: InputEvent): ChordAttempt | null {
    const pending = this.poll(e.t);
    this.state = applyHeldEvent(this.state, e);
    const key = this.heldNotes().join(',');
    if (key !== this.heldKey) {
      if (this.settled) this.gestureStart = e.t;
      this.settled = false;
      this.heldKey = key;
      this.lastChange = e.t;
    }
    return pending;
  }

  /** 用当前时间检查是否已经稳定。 */
  poll(now: number): ChordAttempt | null {
    if (this.settled || this.lastChange === null || this.gestureStart === null) return null;
    if (now - this.lastChange < this.opts.stableMs) return null;
    this.settled = true;
    const notes = this.heldNotes();
    const onsets: Record<number, number> = {};
    const sources: Record<number, string> = {};
    for (const n of notes) {
      const held = this.state.notes.get(n);
      onsets[n] = held?.t ?? this.lastChange;
      sources[n] = held?.source ?? '';
    }
    const start = this.gestureStart;
    const newNotes = notes.filter((n) => (onsets[n] as number) >= start);
    if (newNotes.length === 0) return null;
    const times = newNotes.map((n) => onsets[n] as number);
    const firstOnset = Math.min(...times);
    const lastOnset = Math.max(...times);
    const spreadMs = lastOnset - firstOnset;
    return {
      notes,
      newNotes,
      onsets,
      sources,
      firstOnset,
      lastOnset,
      spreadMs,
      together: spreadMs <= this.opts.onsetWindowMs,
      stableAt: this.lastChange + this.opts.stableMs,
    };
  }

  /** 距离下一次可能稳定还有多久（毫秒）；没有待定状态时为 null。用于安排下一次 poll。 */
  msUntilStable(now: number): number | null {
    if (this.settled || this.lastChange === null) return null;
    return Math.max(0, this.lastChange + this.opts.stableMs - now);
  }

  reset() {
    this.state = EMPTY_HELD_STATE;
    this.heldKey = '';
    this.lastChange = null;
    this.gestureStart = null;
    this.settled = true;
  }
}

/** 纯函数版本：重放一串事件，返回其中所有的和弦尝试。endTime 用于结束时检查最后一个状态。 */
export function findAttempts(
  events: readonly InputEvent[],
  opts: Partial<AttemptOptions> = {},
  endTime?: number,
): ChordAttempt[] {
  const tracker = new AttemptTracker(opts);
  const out: ChordAttempt[] = [];
  for (const e of events) {
    const a = tracker.push(e);
    if (a) out.push(a);
  }
  if (endTime !== undefined) {
    const a = tracker.poll(endTime);
    if (a) out.push(a);
  }
  return out;
}
