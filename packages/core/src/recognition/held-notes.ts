import type { InputEvent } from '../input/events';

/** 当前按住的一个音。 */
export interface HeldNote {
  note: number;
  velocity: number;
  channel: number;
  /** 按下时间（performance.now() 域） */
  t: number;
  /** 手指已松开，但因为延音踏板仍在发声 */
  sustained: boolean;
}

export interface HeldState {
  /** 键为 MIDI 音符号。同一个音在不同通道按下时只保留一份（以最近一次为准）。 */
  notes: ReadonlyMap<number, HeldNote>;
  sustainDown: boolean;
}

export const EMPTY_HELD_STATE: HeldState = { notes: new Map(), sustainDown: false };

export interface HeldOptions {
  /** 踩踏板时松开的音是否仍算"按住"（设置项，默认 false：只看手指） */
  sustainCountsAsHeld: boolean;
}

/**
 * 纯函数：根据一个输入事件更新按住音集合。
 * 无论 sustainCountsAsHeld 如何设置，都记录 sustained 标记，查询时再决定是否计入。
 */
export function applyHeldEvent(state: HeldState, e: InputEvent): HeldState {
  switch (e.kind) {
    case 'noteOn': {
      const notes = new Map(state.notes);
      notes.set(e.note, {
        note: e.note,
        velocity: e.velocity,
        channel: e.channel,
        t: e.t,
        sustained: false,
      });
      return { ...state, notes };
    }
    case 'noteOff': {
      const held = state.notes.get(e.note);
      if (!held) return state;
      const notes = new Map(state.notes);
      if (state.sustainDown) notes.set(e.note, { ...held, sustained: true });
      else notes.delete(e.note);
      return { ...state, notes };
    }
    case 'sustain': {
      if (e.down === state.sustainDown) return state;
      if (e.down) return { ...state, sustainDown: true };
      const notes = new Map<number, HeldNote>();
      for (const [k, v] of state.notes) if (!v.sustained) notes.set(k, v);
      return { notes, sustainDown: false };
    }
    default:
      return state;
  }
}

/** 当前"按住"的音（升序 MIDI 号）。 */
export function heldNoteNumbers(state: HeldState, opts: HeldOptions): number[] {
  const out: number[] = [];
  for (const n of state.notes.values()) {
    if (!n.sustained || opts.sustainCountsAsHeld) out.push(n.note);
  }
  return out.sort((a, b) => a - b);
}
