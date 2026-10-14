import { type InputEvent, parseMidiMessage } from '@mayochord/core';
import type { RawMidiMessage } from '@/input/webmidi';

/** 实测摘要：从原始消息增量统计，用于判断 JUNO-D7 的实际行为。 */
export interface MonitorSummary {
  total: number;
  channels: number[];
  noteMin: number | null;
  noteMax: number | null;
  velocityMin: number | null;
  velocityMax: number | null;
  noteOffAs80: number;
  noteOffAsNoteOnZero: number;
  cc64Values: number[];
  otherCc: Record<number, number>;
  activeSensing: number;
  clock: number;
  clockBpm: number | null;
  startStop: { start: number; stop: number; continue: number };
  programChanges: { channel: number; program: number }[];
  latencyMs: { min: number; max: number; mean: number } | null;
}

export function emptySummary(): MonitorSummary {
  return {
    total: 0,
    channels: [],
    noteMin: null,
    noteMax: null,
    velocityMin: null,
    velocityMax: null,
    noteOffAs80: 0,
    noteOffAsNoteOnZero: 0,
    cc64Values: [],
    otherCc: {},
    activeSensing: 0,
    clock: 0,
    clockBpm: null,
    startStop: { start: 0, stop: 0, continue: 0 },
    programChanges: [],
    latencyMs: null,
  };
}

/** 增量统计器。内部可变，调用 snapshot() 得到不可变副本供渲染。 */
export class SummaryAccumulator {
  private s = emptySummary();
  private channels = new Set<number>();
  private cc64 = new Set<number>();
  private lastClockT: number | null = null;
  private clockIntervalEma: number | null = null;
  private latencySum = 0;

  add(msg: RawMidiMessage, parsed: InputEvent | null) {
    const s = this.s;
    s.total++;
    const lat = msg.recv - msg.t;
    this.latencySum += lat;
    s.latencyMs = s.latencyMs
      ? {
          min: Math.min(s.latencyMs.min, lat),
          max: Math.max(s.latencyMs.max, lat),
          mean: this.latencySum / s.total,
        }
      : { min: lat, max: lat, mean: lat };

    const status = msg.data[0] ?? 0;
    if (status === 0xfe) {
      s.activeSensing++;
      return;
    }
    if (!parsed) return;
    if ('channel' in parsed) this.channels.add(parsed.channel);

    switch (parsed.kind) {
      case 'noteOn':
        s.noteMin = s.noteMin === null ? parsed.note : Math.min(s.noteMin, parsed.note);
        s.noteMax = s.noteMax === null ? parsed.note : Math.max(s.noteMax, parsed.note);
        s.velocityMin =
          s.velocityMin === null ? parsed.velocity : Math.min(s.velocityMin, parsed.velocity);
        s.velocityMax =
          s.velocityMax === null ? parsed.velocity : Math.max(s.velocityMax, parsed.velocity);
        break;
      case 'noteOff':
        if ((status & 0xf0) === 0x80) s.noteOffAs80++;
        else s.noteOffAsNoteOnZero++;
        break;
      case 'sustain':
        this.cc64.add(parsed.value);
        break;
      case 'cc':
        s.otherCc[parsed.controller] = (s.otherCc[parsed.controller] ?? 0) + 1;
        break;
      case 'clock': {
        s.clock++;
        if (this.lastClockT !== null) {
          const dt = parsed.t - this.lastClockT;
          // 超过 250ms 的间隔视为停止后重新开始，不计入
          if (dt > 0 && dt < 250) {
            this.clockIntervalEma =
              this.clockIntervalEma === null ? dt : this.clockIntervalEma * 0.9 + dt * 0.1;
            s.clockBpm = Math.round(60000 / (this.clockIntervalEma * 24));
          }
        }
        this.lastClockT = parsed.t;
        break;
      }
      case 'start':
      case 'stop':
      case 'continue':
        s.startStop[parsed.kind]++;
        break;
      case 'programChange':
        s.programChanges = [
          ...s.programChanges.slice(-9),
          { channel: parsed.channel, program: parsed.value },
        ];
        break;
      default:
        break;
    }
  }

  snapshot(): MonitorSummary {
    return {
      ...this.s,
      channels: [...this.channels].sort((a, b) => a - b),
      cc64Values: [...this.cc64].sort((a, b) => a - b),
      otherCc: { ...this.s.otherCc },
      startStop: { ...this.s.startStop },
    };
  }
}

export interface LogEntry {
  id: number;
  raw: RawMidiMessage;
  parsed: InputEvent | null;
}

export function parseRaw(raw: RawMidiMessage): InputEvent | null {
  return parseMidiMessage(raw.data, raw.t, `webmidi:${raw.portId}`);
}
