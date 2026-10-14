/**
 * 统一的输入事件模型。所有输入源（Web MIDI、屏幕键盘、电脑键盘、模拟输入）都输出这些事件。
 *
 * - `t`：`performance.now()` 时间域的毫秒数（Web MIDI 的 `MIDIMessageEvent.timeStamp` 与之同源）。
 * - `channel`：1–16（与琴的说明书一致），非 MIDI 输入源固定为 1。
 * - `note`：MIDI 音符号，中央 C = C4 = 60。
 */
export type SourceId = string;

interface EventBase {
  t: number;
  source: SourceId;
}

export interface NoteOnEvent extends EventBase {
  kind: 'noteOn';
  note: number;
  velocity: number;
  channel: number;
}

export interface NoteOffEvent extends EventBase {
  kind: 'noteOff';
  note: number;
  velocity: number;
  channel: number;
}

/** CC64 延音踏板。`down` 按 MIDI 惯例：value >= 64 视为踩下。 */
export interface SustainEvent extends EventBase {
  kind: 'sustain';
  down: boolean;
  value: number;
  channel: number;
}

export interface ControlChangeEvent extends EventBase {
  kind: 'cc';
  controller: number;
  value: number;
  channel: number;
}

/** 系统实时消息。clock 等先保留解析能力，练习逻辑暂不使用。 */
export interface RealtimeEvent extends EventBase {
  kind: 'clock' | 'start' | 'continue' | 'stop';
}

/** 其他通道消息（音色切换、弯音、触后）。只用于监视页显示。 */
export interface OtherChannelEvent extends EventBase {
  kind: 'programChange' | 'pitchBend' | 'channelPressure' | 'polyPressure';
  channel: number;
  /** programChange: 音色号；pitchBend: -8192..8191；pressure: 0..127 */
  value: number;
  note?: number;
}

export type InputEvent =
  | NoteOnEvent
  | NoteOffEvent
  | SustainEvent
  | ControlChangeEvent
  | RealtimeEvent
  | OtherChannelEvent;

export type NoteEvent = NoteOnEvent | NoteOffEvent;

export function isNoteEvent(e: InputEvent): e is NoteEvent {
  return e.kind === 'noteOn' || e.kind === 'noteOff';
}

export type SourceStatus =
  | { state: 'idle' }
  | { state: 'connecting' }
  | { state: 'ready'; deviceName?: string }
  | { state: 'unsupported'; reason: string }
  | { state: 'error'; message: string };

/** 输入源适配器接口（扩展点 4.2-1）。实现放在 apps/web/src/input。 */
export interface InputSource {
  readonly id: SourceId;
  readonly label: string;
  start(): Promise<void>;
  stop(): void;
  subscribe(listener: (event: InputEvent) => void): () => void;
}
