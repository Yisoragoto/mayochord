import { strFromU8 } from 'fflate';
import { pitchClassName } from '../theory';
import { assignAccidentals, buildNotes } from './finalize';
import {
  type Hand,
  type NotationElement,
  type Score,
  type ScoreMeasure,
  type ScoreWarning,
  splitTicks,
  TPQ,
} from './model';
import { ScoreImportError } from './musicxml';

/** 标准 MIDI 文件里的一个音（tick 为文件自己的分辨率） */
export interface MidiFileNote {
  track: number;
  channel: number;
  pitch: number;
  velocity: number;
  start: number;
  end: number;
}

export interface MidiFile {
  format: number;
  /** 每个四分音符的 tick 数 */
  ppq: number;
  notes: MidiFileNote[];
  /** 速度变化：tick → 四分音符 BPM */
  tempos: { tick: number; bpm: number }[];
  timeSignatures: { tick: number; beats: number; beatType: number }[];
  keySignatures: { tick: number; fifths: number }[];
  trackNames: string[];
}

class Reader {
  pos = 0;
  constructor(private readonly d: Uint8Array) {}
  get done() {
    return this.pos >= this.d.length;
  }
  u8(): number {
    if (this.pos >= this.d.length) throw new ScoreImportError('midi', 'unexpected end');
    return this.d[this.pos++] as number;
  }
  u16() {
    return (this.u8() << 8) | this.u8();
  }
  u32() {
    return ((this.u16() << 16) >>> 0) + this.u16();
  }
  str(n: number) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8());
    return s;
  }
  bytes(n: number) {
    if (this.pos + n > this.d.length) throw new ScoreImportError('midi', 'unexpected end');
    const b = this.d.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
  vlq() {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new ScoreImportError('midi', 'bad variable-length number');
  }
}

/** 解析标准 MIDI 文件（格式 0、1；只支持按四分音符计的时间分辨率）。 */
export function parseMidiFile(data: Uint8Array): MidiFile {
  const r = new Reader(data);
  if (data.length < 14 || r.str(4) !== 'MThd') throw new ScoreImportError('midi', 'no MThd');
  const headerLen = r.u32();
  const format = r.u16();
  const trackCount = r.u16();
  const division = r.u16();
  r.pos = 8 + headerLen;
  if (format > 1) throw new ScoreImportError('midi-format', `format ${format}`);
  if (division & 0x8000) throw new ScoreImportError('midi-format', 'SMPTE time division');

  const out: MidiFile = {
    format,
    ppq: division,
    notes: [],
    tempos: [],
    timeSignatures: [],
    keySignatures: [],
    trackNames: [],
  };
  for (let track = 0; track < trackCount && !r.done; track++) {
    const id = r.str(4);
    const len = r.u32();
    const end = r.pos + len;
    if (id !== 'MTrk') {
      r.pos = end;
      continue;
    }
    let tick = 0;
    let status = 0;
    const open = new Map<string, MidiFileNote[]>();
    while (r.pos < end) {
      tick += r.vlq();
      let b = r.u8();
      if (b === 0xff) {
        const type = r.u8();
        const data = r.bytes(r.vlq());
        if (type === 0x51 && data.length === 3) {
          const us = ((data[0] as number) << 16) | ((data[1] as number) << 8) | (data[2] as number);
          if (us > 0) out.tempos.push({ tick, bpm: 60_000_000 / us });
        } else if (type === 0x58 && data.length >= 2) {
          out.timeSignatures.push({
            tick,
            beats: data[0] as number,
            beatType: 2 ** (data[1] as number),
          });
        } else if (type === 0x59 && data.length >= 1) {
          const sf = data[0] as number;
          out.keySignatures.push({ tick, fifths: sf > 127 ? sf - 256 : sf });
        } else if (type === 0x03 && out.trackNames[track] === undefined) {
          out.trackNames[track] = strFromU8(data).trim();
        }
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        r.bytes(r.vlq());
        continue;
      }
      if (b & 0x80) status = b;
      else {
        // 运行状态：这个字节已经是数据
        if (!status) throw new ScoreImportError('midi', 'running status without status');
        r.pos--;
        b = status;
      }
      const kind = status & 0xf0;
      const channel = (status & 0x0f) + 1;
      if (kind === 0xc0 || kind === 0xd0) {
        r.u8();
        continue;
      }
      const d1 = r.u8();
      const d2 = r.u8();
      if (kind !== 0x90 && kind !== 0x80) continue;
      const key = `${channel}:${d1}`;
      if (kind === 0x90 && d2 > 0) {
        const note: MidiFileNote = {
          track,
          channel,
          pitch: d1,
          velocity: d2,
          start: tick,
          end: tick,
        };
        out.notes.push(note);
        const list = open.get(key);
        if (list) list.push(note);
        else open.set(key, [note]);
      } else {
        const note = open.get(key)?.shift();
        if (note) note.end = tick;
      }
    }
    // 没有 note off 的音到轨道结束
    for (const list of open.values()) for (const n of list) n.end = Math.max(n.end, tick);
    r.pos = end;
  }
  out.notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return out;
}

const GRID = TPQ / 4;
const quantize = (t: number) => Math.round(t / GRID) * GRID;

function spell(pitch: number, fifths: number): string {
  const spelling = fifths > 0 ? 'sharp' : fifths < 0 ? 'flat' : undefined;
  return `${pitchClassName(pitch, spelling)}${Math.floor(pitch / 12) - 1}`;
}

/**
 * MIDI 文件 → 乐谱。打击乐（通道 10）不要；按 16 分音符对齐。
 * 分手：恰好两条有音的轨道时，平均音高高的是右手；否则以中央 C 为界（≥ C4 右手）。
 * 记谱：每只手一个声部，同时开始的音合成和弦，时值到下一个起音为止，跨小节用连音线。
 */
export function midiToScore(file: MidiFile, fallbackTitle = ''): Score {
  const scale = TPQ / file.ppq;
  const raw = file.notes.filter((n) => n.channel !== 10 && n.end >= n.start);
  if (raw.length === 0) throw new ScoreImportError('no-notes');

  const tracks = [...new Set(raw.map((n) => n.track))];
  let handOf: (n: MidiFileNote) => Hand = (n) => (n.pitch >= 60 ? 'right' : 'left');
  if (tracks.length === 2) {
    const avg = (t: number) => {
      const ps = raw.filter((n) => n.track === t).map((n) => n.pitch);
      return ps.reduce((s, p) => s + p, 0) / ps.length;
    };
    const right = avg(tracks[0] as number) >= avg(tracks[1] as number) ? tracks[0] : tracks[1];
    handOf = (n) => (n.track === right ? 'right' : 'left');
  }

  const qNotes = raw.map((n) => {
    const start = quantize(n.start * scale);
    const end = Math.max(start + GRID, quantize(n.end * scale));
    return { pitch: n.pitch, start, end, hand: handOf(n) };
  });
  const lastEnd = Math.max(...qNotes.map((n) => n.end));

  // 小节
  const sigs = file.timeSignatures.length
    ? file.timeSignatures.map((s) => ({ ...s, tick: quantize(s.tick * scale) }))
    : [{ tick: 0, beats: 4, beatType: 4 }];
  const fifthsAt = (tick: number) => {
    let f = 0;
    for (const k of file.keySignatures) if (k.tick * scale <= tick) f = k.fifths;
    return Math.max(-7, Math.min(7, f));
  };
  const measures: ScoreMeasure[] = [];
  let start = 0;
  let sigIdx = 0;
  while (start < lastEnd || measures.length === 0) {
    while (sigIdx + 1 < sigs.length && (sigs[sigIdx + 1]?.tick ?? 0) <= start) sigIdx++;
    const sig = sigs[sigIdx] as { beats: number; beatType: number };
    let length = Math.round((sig.beats * 4 * TPQ) / sig.beatType);
    const next = sigs[sigIdx + 1];
    if (next && next.tick > start && next.tick < start + length) length = next.tick - start;
    measures.push({
      index: measures.length,
      number: String(measures.length + 1),
      start,
      length,
      beats: sig.beats,
      beatType: sig.beatType,
      fifths: fifthsAt(start),
      clefs: ['treble', 'bass'],
    });
    start += length;
  }
  const measureOf = (tick: number) => {
    let i = measures.length - 1;
    while (i > 0 && (measures[i] as ScoreMeasure).start > tick) i--;
    return i;
  };

  // 记谱元素
  const elements: NotationElement[] = [];
  const pushPiece = (
    staff: number,
    from: number,
    to: number,
    pitches: number[],
    tieIn: boolean,
    tieOut: boolean,
  ) => {
    // 先按小节线切，再拆成能写出来的时值
    const pieces: [number, number][] = [];
    let t = from;
    while (t < to) {
      const m = measures[measureOf(t)] as ScoreMeasure;
      const stop = Math.min(to, m.start + m.length);
      for (const p of splitTicks(stop - t)) {
        pieces.push([t, p.ticks]);
        t += p.ticks;
      }
      if (t < stop) t = stop; // 丢掉写不出来的零头
    }
    pieces.forEach(([s, d], i) => {
      const types = splitTicks(d)[0] as { type: NotationElement['type']; dots: number };
      const m = measureOf(s);
      elements.push({
        measure: m,
        staff,
        voice: '1',
        start: s,
        dur: d,
        rest: pitches.length === 0,
        type: types.type,
        dots: types.dots,
        tuplet: null,
        pitches: pitches.map((p) => ({
          pitch: p,
          spelled: spell(p, (measures[m] as ScoreMeasure).fifths),
          noteId: -1,
          tieStart: i < pieces.length - 1 || tieOut,
          tieStop: i > 0 || tieIn,
          accidental: null,
        })),
      });
    });
  };

  (['right', 'left'] as const).forEach((hand, idx) => {
    const staff = idx + 1;
    const hn = qNotes.filter((n) => n.hand === hand);
    const onsets = [...new Set(hn.map((n) => n.start))].sort((a, b) => a - b);
    let cursor = 0;
    onsets.forEach((onset, i) => {
      const chord = hn.filter((n) => n.start === onset);
      const nextOnset = onsets[i + 1] ?? Number.POSITIVE_INFINITY;
      const end = Math.min(nextOnset, Math.max(...chord.map((n) => n.end)));
      if (onset > cursor) pushPiece(staff, cursor, onset, [], false, false);
      pushPiece(staff, onset, end, [...new Set(chord.map((n) => n.pitch))], false, false);
      cursor = end;
    });
    const scoreEnd = (measures[measures.length - 1] as ScoreMeasure).start;
    const last = measures[measures.length - 1] as ScoreMeasure;
    if (cursor < scoreEnd + last.length)
      pushPiece(staff, cursor, scoreEnd + last.length, [], false, false);
  });

  const staffHands: Hand[] = ['right', 'left'];
  const notes = buildNotes(elements, staffHands);
  // 演奏用的音用真实时值（记谱时被下一个起音截短的音，弹的时候仍按原长）
  const realEnd = new Map<string, number>();
  for (const n of qNotes) {
    const key = `${n.hand}:${n.start}:${n.pitch}`;
    realEnd.set(key, Math.max(realEnd.get(key) ?? 0, n.end));
  }
  for (const n of notes) {
    const end = realEnd.get(`${n.hand}:${n.start}:${n.pitch}`);
    if (end !== undefined) n.dur = Math.max(n.dur, end - n.start);
  }
  assignAccidentals(elements, measures);

  const tempos = file.tempos.map((t) => Math.round(t.bpm));
  const warnings: ScoreWarning[] = [{ kind: 'quantized' }];
  if (new Set(tempos).size > 1) warnings.push({ kind: 'tempo-changes' });
  const name = file.trackNames.find((n) => n);
  return {
    title: fallbackTitle || name || '',
    composer: null,
    format: 'midi',
    staves: 2,
    staffHands,
    measures,
    notes,
    elements,
    tempo: tempos[0] ?? 120,
    tempoMarked: tempos.length > 0,
    warnings,
  };
}
