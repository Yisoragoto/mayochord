import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { chordSequence, labelChords, spellInKey } from './chords';
import { assignAccidentals, keyAlterations } from './finalize';
import {
  buildFollowPlan,
  measureErrorRate,
  msPerTick,
  startTempo,
  startWait,
  stepGapTicks,
  stopTempo,
  summarizeTempo,
  summarizeWait,
  type TempoTiming,
  tempoNoteOn,
  tempoStepClean,
  tempoStepTime,
  tempoTick,
  waitCurrent,
  waitNoteOn,
  waitRemaining,
  waitSkipAuto,
  worstMeasures,
} from './follow';
import {
  decodeText,
  detectScoreFormat,
  fromBase64,
  importScoreFile,
  parseScoreSource,
  titleFromFileName,
  toBase64,
} from './import';
import { midiToScore, parseMidiFile } from './midi-file';
import {
  hasRepeats,
  measureAt,
  type NotationElement,
  notatedTicks,
  type ScoreMeasure,
  scoreEnd,
  splitTicks,
  TPQ,
  ticksToType,
} from './model';
import { extractMxl, parseMusicXml, ScoreImportError } from './musicxml';
import {
  EMPTY_FLOW,
  type MeasureFlow,
  parseEndingNumbers,
  playbackOrder,
  practiceSequence,
} from './repeats';
import { child, childNumber, childText, parseXml, XmlError } from './xml';

// ───────────────────────────── XML ─────────────────────────────

describe('parseXml', () => {
  it('parses elements, attributes, text, entities, CDATA and skips prolog/comments', () => {
    const root = parseXml(
      `﻿<?xml version="1.0"?>
<!DOCTYPE x [ <!ENTITY foo "bar"> ]>
<!-- c -->
<a x="1" y='&lt;2&gt;'><b>t &amp; &#65;&#x42;</b><c/><![CDATA[<raw>]]></a>`,
    );
    expect(root.name).toBe('a');
    expect(root.attrs).toEqual({ x: '1', y: '<2>' });
    expect(childText(root, 'b')).toBe('t & AB');
    expect(child(root, 'c')).toBeDefined();
    expect(root.text).toBe('<raw>');
    expect(childNumber(root, 'b')).toBeUndefined();
    expect(childNumber(root, 'zzz')).toBeUndefined();
  });

  it('accepts a DOCTYPE without internal subset', () => {
    expect(parseXml('<!DOCTYPE a PUBLIC "x" "y"><a/>').name).toBe('a');
  });

  it.each([
    ['<a><b></a>', 'Mismatched'],
    ['<a>', 'Unclosed'],
    ['text<a/>', 'outside'],
    ['<a/><b/>', 'Multiple'],
    ['', 'No root'],
    ['<a>&nope;</a>', 'entity'],
    ['<a x=1/>', 'Malformed'],
    ['< a/>', 'Invalid'],
    ['<!-- x', 'comment'],
    ['<a><![CDATA[x</a>', 'CDATA'],
    ['<!DOCTYPE a', 'DOCTYPE'],
    ['<a></a', 'closing tag'],
  ])('rejects %s', (src, msg) => {
    expect(() => parseXml(src)).toThrow(XmlError);
    expect(() => parseXml(src)).toThrow(msg);
  });
});

// ───────────────────────────── 模型 ─────────────────────────────

describe('durations', () => {
  it('converts types and dots to ticks and back', () => {
    expect(notatedTicks('quarter', 0)).toBe(TPQ);
    expect(notatedTicks('quarter', 1)).toBe(TPQ * 1.5);
    expect(notatedTicks('half', 2)).toBe(TPQ * 3.5);
    expect(notatedTicks('eighth', 0, { actual: 3, normal: 2 })).toBe(TPQ / 3);
    expect(ticksToType(TPQ * 3)).toEqual({ type: 'half', dots: 1 });
    expect(ticksToType(TPQ * 5)).toBeNull();
  });

  it('splits awkward lengths into writable notes', () => {
    expect(splitTicks(TPQ * 2.5).map((p) => [p.type, p.dots])).toEqual([
      ['half', 0],
      ['eighth', 0],
    ]);
    expect(splitTicks(TPQ * 1.5)).toEqual([{ type: 'quarter', dots: 1, ticks: TPQ * 1.5 }]);
    expect(splitTicks(10)).toEqual([]);
  });

  it('finds the measure of a tick', () => {
    const ms = [0, 100, 300].map((start, index) => ({ index, start }) as ScoreMeasure);
    expect(measureAt(ms, 0)).toBe(0);
    expect(measureAt(ms, 150)).toBe(1);
    expect(measureAt(ms, 9999)).toBe(2);
    expect(measureAt(ms, -5)).toBe(0);
  });
});

describe('accidentals', () => {
  it('knows key signatures', () => {
    expect(keyAlterations(2)).toEqual({ F: 1, C: 1 });
    expect(keyAlterations(-3)).toEqual({ B: -1, E: -1, A: -1 });
    expect(keyAlterations(0)).toEqual({});
  });

  it('shows accidentals against the key and carries them through the measure', () => {
    const mk = (start: number, spelled: string, extra: Partial<NotationElement> = {}) =>
      ({
        measure: 0,
        staff: 1,
        voice: '1',
        start,
        dur: TPQ,
        rest: false,
        type: 'quarter',
        dots: 0,
        tuplet: null,
        pitches: [
          { pitch: 0, spelled, noteId: 0, tieStart: false, tieStop: false, accidental: null },
        ],
        ...extra,
      }) as NotationElement;
    const els = [mk(0, 'F4'), mk(TPQ, 'F#4'), mk(TPQ * 2, 'F#4'), mk(TPQ * 3, 'Bb4')];
    const tied = mk(TPQ * 3, 'C#5');
    (tied.pitches[0] as { tieStop: boolean }).tieStop = true;
    const rest = { ...mk(0, 'C4'), rest: true, pitches: [] };
    const measures = [{ fifths: 1 } as ScoreMeasure];
    assignAccidentals([...els, tied, rest], measures);
    expect(els.map((e) => e.pitches[0]?.accidental)).toEqual(['n', '#', null, 'b']);
    expect(tied.pitches[0]?.accidental).toBeNull();
  });
});

// ───────────────────────────── MusicXML ─────────────────────────────

const note = (
  step: string,
  octave: number,
  dur: number,
  opts: {
    alter?: number;
    staff?: number;
    voice?: string;
    type?: string;
    chord?: boolean;
    tie?: ('start' | 'stop')[];
    dots?: number;
    tuplet?: [number, number];
    grace?: boolean;
    cue?: boolean;
  } = {},
) =>
  `<note>${opts.grace ? '<grace/>' : ''}${opts.cue ? '<cue/>' : ''}${opts.chord ? '<chord/>' : ''}<pitch><step>${step}</step>${
    opts.alter ? `<alter>${opts.alter}</alter>` : ''
  }<octave>${octave}</octave></pitch><duration>${dur}</duration>${(opts.tie ?? [])
    .map((t) => `<tie type="${t}"/>`)
    .join(
      '',
    )}<voice>${opts.voice ?? '1'}</voice>${opts.type ? `<type>${opts.type}</type>` : ''}${'<dot/>'.repeat(
    opts.dots ?? 0,
  )}${opts.tuplet ? `<time-modification><actual-notes>${opts.tuplet[0]}</actual-notes><normal-notes>${opts.tuplet[1]}</normal-notes></time-modification>` : ''}${
    opts.staff ? `<staff>${opts.staff}</staff>` : ''
  }</note>`;

const rest = (dur: number, staff = 1, measure = false) =>
  `<note><rest${measure ? ' measure="yes"' : ''}/><duration>${dur}</duration><voice>1</voice>${
    measure ? '' : '<type>quarter</type>'
  }<staff>${staff}</staff></note>`;

const xmlScore = (parts: string, partList = '') =>
  `<?xml version="1.0"?><score-partwise><movement-title>Mvt</movement-title><identification><creator type="composer">Someone</creator></identification><part-list>${partList}</part-list>${parts}</score-partwise>`;

const ATTR = (staves = 2, divisions = 2) =>
  `<attributes><divisions>${divisions}</divisions><key><fifths>-1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>${staves}</staves><clef number="1"><sign>G</sign></clef><clef number="2"><sign>F</sign></clef></attributes>`;

describe('parseMusicXml', () => {
  it('parses a two-staff piano part with chords, backup, ties, dots and tuplets', () => {
    const xml = xmlScore(
      `<part id="P1"><measure number="1">${ATTR(2, 6)}<direction><sound tempo="88"/></direction>${note(
        'C',
        5,
        9,
        { type: 'quarter', dots: 1, staff: 1 },
      )}${note('D', 5, 3, { type: 'eighth', staff: 1 })}${note('E', 5, 12, {
        type: 'half',
        staff: 1,
        tie: ['start'],
      })}<backup><duration>24</duration></backup>${note('C', 3, 24, {
        type: 'whole',
        staff: 2,
        voice: '5',
      })}${note('G', 3, 24, { type: 'whole', staff: 2, voice: '5', chord: true })}</measure>` +
        `<measure number="2">${note('E', 5, 6, { type: 'quarter', staff: 1, tie: ['stop'] })}${[
          0, 1, 2,
        ]
          .map(() => note('B', 4, 2, { type: 'eighth', staff: 1, alter: -1, tuplet: [3, 2] }))
          .join(
            '',
          )}${rest(6)}${rest(6)}<backup><duration>24</duration></backup>${rest(24, 2, true)}</measure></part>`,
      '<score-part id="P1"><part-name>Piano</part-name></score-part>',
    );
    const s = parseMusicXml(xml, 'fallback');
    expect(s.title).toBe('Mvt');
    expect(s.composer).toBe('Someone');
    expect(s.tempo).toBe(88);
    expect(s.tempoMarked).toBe(true);
    expect(s.staves).toBe(2);
    expect(s.staffHands).toEqual(['right', 'left']);
    expect(s.measures.map((m) => [m.start, m.length, m.fifths])).toEqual([
      [0, TPQ * 4, -1],
      [TPQ * 4, TPQ * 4, -1],
    ]);
    expect(s.measures[0]?.clefs).toEqual(['treble', 'bass']);
    // 连音线合并：E5 从第 1 小节第 3 拍持续到第 2 小节第 1 拍结束
    const e5 = s.notes.find((n) => n.pitch === 76);
    expect(e5).toMatchObject({ start: TPQ * 2, dur: TPQ * 3, hand: 'right', measure: 0 });
    expect(s.notes.filter((n) => n.pitch === 76)).toHaveLength(1);
    expect(s.notes.filter((n) => n.hand === 'left').map((n) => n.pitch)).toEqual([48, 55]);
    const triplet = s.elements.filter((e) => e.tuplet);
    expect(triplet).toHaveLength(3);
    expect(triplet[0]?.pitches[0]?.spelled).toBe('Bb4');
    // 调号一个降号：Bb 不用画
    expect(triplet[0]?.pitches[0]?.accidental).toBeNull();
    const dotted = s.elements.find((e) => e.dots === 1);
    expect(dotted?.type).toBe('quarter');
    const wholeRest = s.elements.find((e) => e.rest && e.staff === 2);
    expect(wholeRest?.type).toBe('whole');
    expect(s.notes.map((n) => n.id)).toEqual(s.notes.map((_, i) => i));
    expect(s.warnings).toEqual([]);
    expect(scoreEnd(s)).toBe(TPQ * 8);
  });

  it('combines two single-staff parts and warns about the rest', () => {
    const part = (id: string, step: string, octave: number, clef = 'G') =>
      `<part id="${id}"><measure number="1"><attributes><divisions>1</divisions><clef><sign>${clef}</sign></clef></attributes>${note(
        step,
        octave,
        4,
        { type: 'whole' },
      )}</measure><measure number="2">${note(step, octave, 4, { type: 'whole' })}<barline><repeat direction="backward"/></barline></measure></part>`;
    const s = parseMusicXml(
      xmlScore(
        `<part id="D"><measure number="1">${rest(4)}</measure></part>${part('A', 'C', 5)}${part('B', 'C', 3, 'F')}${part('C', 'E', 4)}`,
        '<score-part id="A"><part-name>Flute</part-name></score-part><score-part id="C"><part-name>Viola</part-name></score-part>',
      ),
    );
    expect(s.staves).toBe(2);
    expect(s.measures[0]?.clefs).toEqual(['treble', 'bass']);
    expect(s.notes.map((n) => [n.pitch, n.hand])).toEqual([
      [72, 'right'],
      [48, 'left'],
      [72, 'right'],
      [48, 'left'],
    ]);
    expect(s.warnings).toContainEqual({ kind: 'parts-ignored', parts: ['Viola'] });
    // 第 2 小节末尾有后反复：弹两遍
    expect(s.playback).toEqual([0, 1, 0, 1]);
    expect(s.tempo).toBe(120);
    expect(s.tempoMarked).toBe(false);
    expect(s.title).toBe('Mvt');
  });

  it('uses a single bass-clef staff as the left hand; ignores grace and cue notes; reads forward', () => {
    const s = parseMusicXml(
      `<score-partwise><work><work-title>W</work-title></work><part id="P"><measure number="0" implicit="yes"><attributes><divisions>1</divisions><clef><sign>F</sign></clef></attributes>${note(
        'D',
        3,
        1,
        { grace: true },
      )}${note('C', 3, 1)}</measure><measure number="1"><sound tempo="60"/><forward><duration>2</duration></forward>${note(
        'E',
        3,
        1,
        { cue: true },
      )}${note('F', 3, 1, { alter: 1 })}<direction><sound dacapo="yes" tempo="70"/></direction></measure><measure number="2"/></part></score-partwise>`,
    );
    expect(s.title).toBe('W');
    expect(s.staves).toBe(1);
    expect(s.staffHands).toEqual(['left']);
    // 弱起小节只有一拍
    expect(s.measures.map((m) => [m.number, m.length])).toEqual([
      ['0', TPQ],
      ['1', TPQ * 4],
      ['2', TPQ * 4],
    ]);
    expect(s.notes.map((n) => [n.pitch, n.start])).toEqual([
      [48, 0],
      [54, TPQ * 4],
    ]);
    expect(s.elements.find((e) => e.pitches[0]?.pitch === 54)?.pitches[0]?.accidental).toBe('#');
    expect(s.warnings.map((w) => w.kind).sort()).toEqual(['grace-notes', 'tempo-changes']);
    // 第 1 小节（下标）末尾 D.C.：回到开头再弹一遍
    expect(s.playback).toEqual([0, 1, 0, 1, 2]);
    expect(s.tempo).toBe(60);
  });

  it('handles alto clefs and a third staff', () => {
    const s = parseMusicXml(
      xmlScore(
        `<part id="P"><measure number="1"><attributes><divisions>1</divisions><staves>3</staves><clef number="1"><sign>C</sign></clef><clef number="3"><sign>G</sign></clef></attributes>${note('C', 4, 4, { staff: 3, type: 'whole' })}</measure></part>`,
      ),
    );
    expect(s.measures[0]?.clefs).toEqual(['alto', 'bass']);
    expect(s.notes[0]?.hand).toBe('left');
  });

  it.each([
    ['<a', 'xml'],
    ['<score-timewise/>', 'timewise'],
    ['<foo/>', 'not-musicxml'],
    [
      `<score-partwise><part id="P"><measure>${rest(4)}</measure></part></score-partwise>`,
      'no-notes',
    ],
  ])('rejects %s', (xml, code) => {
    expect(() => parseMusicXml(xml)).toThrow(expect.objectContaining({ code }));
  });
});

describe('extractMxl', () => {
  const xml = xmlScore(
    `<part id="P"><measure number="1"><attributes><divisions>1</divisions></attributes>${note('C', 4, 4)}</measure></part>`,
  );
  it('reads the root file named in container.xml', () => {
    const zip = zipSync({
      'META-INF/container.xml': strToU8(
        '<container><rootfiles><rootfile full-path="score/main.xml"/></rootfiles></container>',
      ),
      'score/main.xml': strToU8(xml),
      'other.xml': strToU8('<x/>'),
    });
    expect(extractMxl(zip)).toBe(xml);
  });

  it('falls back to the first xml file', () => {
    const zip = zipSync({
      'META-INF/container.xml': strToU8('<broken'),
      'a.musicxml': strToU8(xml),
    });
    expect(extractMxl(zip)).toBe(xml);
  });

  it('rejects broken or empty archives', () => {
    expect(() => extractMxl(new Uint8Array([80, 75, 1, 2, 3]))).toThrow(ScoreImportError);
    expect(() => extractMxl(zipSync({ 'readme.txt': strToU8('x') }))).toThrow('no score file');
  });
});

// ───────────────────────────── MIDI ─────────────────────────────

const vlq = (n: number): number[] => {
  const out = [n & 0x7f];
  for (let v = n >> 7; v > 0; v >>= 7) out.unshift((v & 0x7f) | 0x80);
  return out;
};
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const track = (events: number[][]) => {
  const body = [...events.flat(), 0, 0xff, 0x2f, 0];
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body];
};
const smf = (format: number, ppq: number, tracks: number[][]) =>
  new Uint8Array([
    0x4d,
    0x54,
    0x68,
    0x64,
    ...u32(6),
    0,
    format,
    0,
    tracks.length,
    ppq >> 8,
    ppq & 255,
    ...tracks.flat(),
  ]);
/** delta + 事件字节 */
const ev = (delta: number, ...bytes: number[]) => [...vlq(delta), ...bytes];

describe('parseMidiFile / midiToScore', () => {
  const ppq = 480;
  const conductor = track([
    ev(0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20), // 120 BPM
    ev(0, 0xff, 0x58, 4, 3, 2, 24, 8), // 3/4
    ev(0, 0xff, 0x59, 2, 0xfe, 0), // 两个降号
    ev(0, 0xff, 0x03, 3, 0x52, 0x48, 0x20),
    ev(ppq * 3, 0xff, 0x51, 3, 0x0f, 0x42, 0x40), // 60 BPM
  ]);
  const rh = track([
    ev(0, 0xc0, 1), // 音色
    ev(0, 0x90, 70, 90), // Bb4
    ev(ppq, 0x80, 70, 0),
    ev(0, 0x90, 72, 80),
    ev(0, 74, 80), // 运行状态：D5 同时
    ev(ppq * 2 + 10, 74, 0), // 运行状态 velocity 0 = note off
    ev(0, 0x80, 72, 0),
    ev(0, 0xf0, 2, 1, 0xf7), // sysex
    ev(0, 0xb0, 64, 127),
    ev(0, 0x99, 36, 100), // 打击乐
    ev(ppq, 0x89, 36, 0),
    ev(0, 0x90, 66, 80), // F#4，跨小节到第 3 小节
    ev(ppq * 4, 0x80, 66, 0),
    ev(0, 0x90, 60, 1), // 没有 note off
  ]);
  const lh = track([ev(0, 0x91, 46, 70), ev(ppq * 6, 0x81, 46, 0), ev(0, 0xe1, 0, 64)]);

  it('parses events, running status, meta and unterminated notes', () => {
    const f = parseMidiFile(smf(1, ppq, [conductor, rh, lh]));
    expect(f.ppq).toBe(ppq);
    expect(f.tempos).toEqual([
      { tick: 0, bpm: 120 },
      { tick: ppq * 3, bpm: 60 },
    ]);
    expect(f.timeSignatures).toEqual([{ tick: 0, beats: 3, beatType: 4 }]);
    expect(f.keySignatures).toEqual([{ tick: 0, fifths: -2 }]);
    expect(f.trackNames[0]).toBe('RH');
    expect(f.notes.find((n) => n.pitch === 74)).toMatchObject({ start: ppq, end: ppq * 3 + 10 });
    expect(f.notes.find((n) => n.pitch === 36)?.channel).toBe(10);
    expect(f.notes.find((n) => n.pitch === 60)?.end).toBe(
      f.notes.find((n) => n.pitch === 60)?.start,
    );
  });

  it('builds a two-staff score: tracks become hands, notes quantized, bars tied', () => {
    const s = midiToScore(parseMidiFile(smf(1, ppq, [conductor, rh, lh])), 'Song');
    expect(s.title).toBe('Song');
    expect(s.format).toBe('midi');
    expect(s.tempo).toBe(120);
    expect(s.warnings.map((w) => w.kind)).toEqual(['quantized', 'tempo-changes']);
    expect(s.measures[0]).toMatchObject({ beats: 3, beatType: 4, fifths: -2, length: TPQ * 3 });
    expect(s.notes.filter((n) => n.hand === 'left').map((n) => n.pitch)).toEqual([46]);
    expect(s.notes.find((n) => n.pitch === 74)?.dur).toBe(TPQ * 2);
    // 打击乐不要
    expect(s.notes.some((n) => n.pitch === 36)).toBe(false);
    // F#4 从第 2 小节第 2 拍持续 4 拍 → 记谱上跨小节连音线，演奏时是一个音
    const fs = s.notes.filter((n) => n.pitch === 66);
    expect(fs).toHaveLength(1);
    expect(fs[0]?.dur).toBe(TPQ * 4);
    const fsEls = s.elements.filter((e) => e.pitches.some((p) => p.pitch === 66));
    expect(fsEls.length).toBeGreaterThan(1);
    expect(fsEls[0]?.pitches[0]?.tieStart).toBe(true);
    // 降号调里按降号拼写：G♭ 要画降号，B♭ 不用
    expect(fsEls[0]?.pitches[0]).toMatchObject({ spelled: 'Gb4', accidental: 'b' });
    expect(s.elements.find((e) => e.pitches[0]?.pitch === 70)?.pitches[0]).toMatchObject({
      spelled: 'Bb4',
      accidental: null,
    });
    // 每个谱表的记谱时值加起来正好填满所有小节
    const total = s.measures.reduce((a, m) => a + m.length, 0);
    for (const staff of [1, 2]) {
      expect(s.elements.filter((e) => e.staff === staff).reduce((a, e) => a + e.dur, 0)).toBe(
        total,
      );
    }
  });

  it('splits a single track at middle C and uses defaults', () => {
    const t = track([
      ev(0, 0x90, 48, 80),
      ev(0, 0x90, 64, 80),
      ev(ppq, 0x80, 48, 0),
      ev(0, 0x80, 64, 0),
      ev(0, 0x90, 61, 80),
      ev(ppq / 2, 0x80, 61, 0),
    ]);
    const s = midiToScore(parseMidiFile(smf(0, ppq, [t])));
    expect(s.notes.map((n) => [n.pitch, n.hand])).toEqual([
      [64, 'right'],
      [48, 'left'],
      [61, 'right'],
    ]);
    expect(s.tempo).toBe(120);
    expect(s.tempoMarked).toBe(false);
    expect(s.title).toBe('');
    expect(s.measures).toHaveLength(1);
    expect(s.elements.find((e) => e.pitches[0]?.pitch === 61)?.pitches[0]?.spelled).toBe('Db4');
  });

  it('starts a new bar at a mid-bar time signature change and spells sharps in sharp keys', () => {
    const t = track([
      ev(0, 0xff, 0x59, 2, 2, 0),
      ev(0, 0xff, 0x58, 4, 4, 2, 24, 8),
      ev(ppq * 2, 0xff, 0x58, 4, 3, 2, 24, 8),
      ev(0, 0x90, 61, 80),
      ev(ppq * 3, 0x80, 61, 0),
      ev(0, 0x90, 63, 80),
      ev(ppq, 0x80, 63, 0),
    ]);
    const s = midiToScore(parseMidiFile(smf(0, ppq, [t])));
    expect(s.measures.map((m) => [m.start, m.length])).toEqual([
      [0, TPQ * 2],
      [TPQ * 2, TPQ * 3],
      [TPQ * 5, TPQ * 3],
    ]);
    expect(s.elements.find((e) => e.pitches[0]?.pitch === 63)?.pitches[0]?.spelled).toBe('D#4');
  });

  it.each([
    [new Uint8Array([1, 2, 3]), 'midi'],
    [smf(2, 480, []), 'midi-format'],
    [smf(1, 0x8000 | 25, []), 'midi-format'],
    [new Uint8Array([...smf(0, 480, []), 0x4d]), 'no-notes'],
  ])('rejects bad files (%#)', (bytes, code) => {
    expect(() => midiToScore(parseMidiFile(bytes))).toThrow(expect.objectContaining({ code }));
  });

  it('rejects truncated tracks and bad numbers', () => {
    const trunc = new Uint8Array([...smf(0, 480, [track([ev(0, 0x90, 60, 80)])]).slice(0, -6)]);
    expect(() => parseMidiFile(trunc)).toThrow(ScoreImportError);
    const badVlq = smf(0, 480, [[0x4d, 0x54, 0x72, 0x6b, ...u32(5), 0xff, 0xff, 0xff, 0xff, 0x7f]]);
    expect(() => parseMidiFile(badVlq)).toThrow('variable-length');
    const noStatus = smf(0, 480, [[0x4d, 0x54, 0x72, 0x6b, ...u32(3), 0, 60, 80]]);
    expect(() => parseMidiFile(noStatus)).toThrow('running status');
  });

  it('skips unknown chunks', () => {
    const f = parseMidiFile(
      smf(0, 480, [
        [0x58, 0x58, 0x58, 0x58, ...u32(2), 1, 2],
        track([ev(0, 0x90, 60, 80), ev(480, 0x80, 60, 0)]),
      ]),
    );
    expect(f.notes).toHaveLength(1);
  });
});

// ───────────────────────────── 导入 ─────────────────────────────

describe('importScoreFile', () => {
  const xml = xmlScore(
    `<part id="P"><measure number="1"><attributes><divisions>1</divisions></attributes>${note('C', 4, 4)}</measure></part>`,
  );

  it('detects formats by content', () => {
    expect(detectScoreFormat(smf(0, 480, []))).toBe('midi');
    expect(detectScoreFormat(zipSync({ a: strToU8('x') }))).toBe('mxl');
    expect(detectScoreFormat(strToU8(`  ${xml}`))).toBe('musicxml');
    expect(detectScoreFormat(strToU8('hello'))).toBeNull();
  });

  it('round-trips base64 and decodes UTF-16', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 200]) {
      const bytes = new Uint8Array(Array.from({ length: n }, (_, i) => (i * 37) % 256));
      expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    }
    expect(toBase64(strToU8('Man'))).toBe('TWFu');
    const le = new Uint8Array([0xff, 0xfe, 0x3c, 0, 0x61, 0]);
    const be = new Uint8Array([0xfe, 0xff, 0, 0x3c, 0, 0x61]);
    expect(decodeText(le)).toBe('<a');
    expect(decodeText(be)).toBe('<a');
  });

  it('imports MusicXML, MXL and MIDI and re-parses the stored source', () => {
    const a = importScoreFile(strToU8(xml), 'a.musicxml');
    expect(a.format).toBe('musicxml');
    expect(a.source).toEqual({ kind: 'musicxml', text: xml });
    const b = importScoreFile(zipSync({ 'x.xml': strToU8(xml) }), 'b.mxl');
    expect(b.format).toBe('mxl');
    expect(b.score.notes).toHaveLength(1);
    const mid = smf(0, 480, [track([ev(0, 0x90, 60, 80), ev(480, 0x80, 60, 0)])]);
    const c = importScoreFile(mid, 'My Song.mid');
    expect(c.score.title).toBe('My Song');
    expect(parseScoreSource(c.source, 'X').notes).toEqual(c.score.notes);
    expect(() => importScoreFile(strToU8('nope'), 'x.pdf')).toThrow(
      expect.objectContaining({ code: 'unknown-format' }),
    );
    expect(titleFromFileName('Mabool.MXL')).toBe('Mabool');
  });
});

// ───────────────────────────── 跟弹判定 ─────────────────────────────

/** 两个小节：右手 C D E F（四分音符），左手第 1、3 拍 C3、G3；第 2 小节右手 C+E 和弦全音符，左手休止 */
const followXml = xmlScore(
  `<part id="P"><measure number="1">${ATTR(2, 1)}${['C', 'D', 'E', 'F']
    .map((s) => note(s, 4, 1, { staff: 1 }))
    .join('')}<backup><duration>4</duration></backup>${note('C', 3, 2, { staff: 2 })}${note(
    'G',
    2,
    2,
    {
      staff: 2,
    },
  )}</measure><measure number="2">${note('C', 4, 4, { staff: 1 })}${note('E', 4, 4, {
    staff: 1,
    chord: true,
  })}</measure></part>`,
);
const followScore = parseMusicXml(followXml);

describe('buildFollowPlan', () => {
  it('groups onsets and splits hands', () => {
    const plan = buildFollowPlan(followScore, 'right', 0, 1);
    expect(
      plan.steps.map((s) => [s.tick, s.notes.map((n) => n.pitch), s.auto.map((n) => n.pitch)]),
    ).toEqual([
      [0, [60], [48]],
      [TPQ, [62], []],
      [TPQ * 2, [64], [43]],
      [TPQ * 3, [65], []],
      [TPQ * 4, [60, 64], []],
    ]);
    expect(plan.length).toBe(TPQ * 8);
    const left = buildFollowPlan(followScore, 'left', 1, 9);
    expect(left).toMatchObject({ from: 1, to: 1, start: 0, segments: [{ measure: 1, start: 0 }] });
    expect(left.steps[0]?.notes).toEqual([]);
    expect(buildFollowPlan(followScore, 'both', 5, 0).from).toBe(1);
  });

  it('computes gaps across the loop boundary', () => {
    const plan = buildFollowPlan(followScore, 'both', 0, 1);
    expect(stepGapTicks(plan, 0)).toBe(TPQ);
    // 最后一组（第 2 小节开头）到下一遍的第一组：一个全音符
    expect(stepGapTicks(plan, 4)).toBe(TPQ * 4);
    expect(msPerTick(60)).toBeCloseTo(1000 / TPQ);
  });
});

describe('wait mode', () => {
  const plan = buildFollowPlan(followScore, 'right', 0, 1);

  it('advances when every note of the group is pressed; wrong notes mark the group', () => {
    let s = startWait(plan, 1, 0);
    expect(waitCurrent(s)?.tick).toBe(0);
    s = waitNoteOn(s, 60, 100);
    expect(s.k).toBe(1);
    expect(s.results[0]).toMatchObject({ correct: true, ms: 100, measure: 0 });
    s = waitNoteOn(s, 61, 150);
    s = waitNoteOn(s, 61, 160);
    expect(s.wrong).toEqual([61]);
    s = waitNoteOn(s, 62, 200);
    expect(s.results[1]).toMatchObject({ correct: false, wrongNotes: [61] });
    s = waitNoteOn(waitNoteOn(s, 64, 300), 65, 400);
    // 和弦：一个一个按也可以，重复按不算错
    s = waitNoteOn(s, 60, 500);
    expect(waitRemaining(s)).toEqual([64]);
    s = waitNoteOn(s, 60, 510);
    s = waitNoteOn(s, 64, 600);
    expect(s.finished).toBe(true);
    expect(waitCurrent(s)).toBeNull();
    expect(waitRemaining(s)).toEqual([]);
    expect(waitNoteOn(s, 60, 700)).toBe(s);
    const sum = summarizeWait(s.results);
    expect(sum).toMatchObject({ mode: 'wait', total: 5, correct: 4, extra: 1, onBeatRate: null });
    expect(sum.measures).toEqual([
      { measure: 0, total: 4, errors: 1, offBeat: 0 },
      { measure: 1, total: 1, errors: 0, offBeat: 0 },
    ]);
  });

  it('skips groups that only have the other hand, and loops', () => {
    const left = buildFollowPlan(followScore, 'left', 0, 1);
    let s = startWait(left, null, 0);
    expect(waitSkipAuto(s, 5)).toBe(s);
    s = waitNoteOn(s, 48, 10);
    expect(waitCurrent(s)?.notes).toEqual([]);
    expect(waitNoteOn(s, 62, 20)).toBe(s);
    s = waitSkipAuto(s, 30);
    expect(s.results).toHaveLength(1);
    for (let i = 0; i < 20; i++) {
      const cur = waitCurrent(s);
      s = cur?.notes.length
        ? waitNoteOn(s, cur.notes[0]?.pitch as number, 40 + i)
        : waitSkipAuto(s, 40 + i);
    }
    expect(s.finished).toBe(false);
    expect(s.k).toBeGreaterThan(left.steps.length);
    expect(startWait({ ...left, steps: [] }, 1, 0).finished).toBe(true);
  });
});

describe('tempo mode', () => {
  const plan = buildFollowPlan(followScore, 'right', 0, 1);
  // 60 BPM：一拍 1000 ms
  const timing: TempoTiming = {
    startT: 1000,
    msPerTick: msPerTick(60),
    latencyMs: 20,
    matchWindowMs: 250,
    toleranceMs: 60,
  };

  it('matches notes to the nearest expected note, records offsets, misses and extras', () => {
    let s = startTempo(plan, 1, timing);
    expect(tempoStepTime(s, 1)).toBe(2000);
    // 预备拍里按的不算
    s = tempoNoteOn(s, 60, 500);
    expect(s.pending.size).toBe(0);
    s = tempoNoteOn(s, 60, 1030); // +10 ms（扣除 20 ms 延迟）
    s = tempoNoteOn(s, 61, 1100); // 多按
    s = tempoNoteOn(s, 62, 2120); // +100 ms：配上了但不在拍上
    // 第 3 组（E4）漏弹；第 4 组 F4 早 80 ms
    s = tempoNoteOn(s, 65, 3940);
    // 按下时先定下已经过去的组（漏弹的 E4 在 F4 按下时定下）
    expect(s.results.map((r) => r.k)).toEqual([0, 1, 2]);
    s = tempoNoteOn(s, 60, 5000);
    expect(s.results.map((r) => r.k)).toEqual([0, 1, 2, 3]);
    expect(s.results[0]).toMatchObject({ offsets: [10], onBeat: 1, extras: [61], missed: [] });
    expect(tempoStepClean(s.results[0] as never)).toBe(false);
    expect(s.results[1]).toMatchObject({ offsets: [100], onBeat: 0 });
    s = tempoTick(s, 9000);
    expect(s.finished).toBe(true);
    expect(tempoTick(s, 10_000)).toBe(s);
    expect(tempoNoteOn(s, 60, 10_000)).toBe(s);
    expect(s.results[2]).toMatchObject({ missed: [64], offsets: [] });
    expect(s.results[3]).toMatchObject({ offsets: [-80] });
    expect(s.results[4]).toMatchObject({ offsets: [-20], missed: [64] });
    const sum = summarizeTempo(s.results);
    expect(sum).toMatchObject({ mode: 'tempo', total: 6, correct: 4, missed: 2, extra: 1 });
    expect(sum.onBeatRate).toBeCloseTo(0.5);
    expect(sum.meanOffsetMs).toBe(3);
    expect(sum.measures[0]).toEqual({ measure: 0, total: 4, errors: 2, offBeat: 2 });
  });

  it('assigns a far wrong note to the nearest group and keeps clean groups clean', () => {
    let s = startTempo(plan, null, timing);
    s = tempoNoteOn(s, 60, 1020);
    s = tempoNoteOn(s, 70, 1600); // 离第 1 组 580 ms、第 2 组 420 ms → 第 2 组的多按
    s = tempoTick(s, 3000);
    expect(s.results[0] && tempoStepClean(s.results[0])).toBe(true);
    expect(s.results[1]?.extras).toEqual([70]);
    // 无限循环：第 2 遍的第一组在 1000 + 8000
    expect(tempoStepTime(s, plan.steps.length)).toBe(9000);
    // 第 3 组（E4，t = 3000）刚弹到、窗口还没关：结束时也算上；第 4 组没弹，不算漏弹
    s = tempoNoteOn(s, 64, 3020);
    s = stopTempo(s);
    expect(s.finished).toBe(true);
    expect(s.results.map((r) => r.k)).toEqual([0, 1, 2]);
    expect(stopTempo(s)).toBe(s);
    expect(summarizeTempo([]).onBeatRate).toBeNull();
  });

  it('handles plans with no notes for the chosen hand', () => {
    const left = buildFollowPlan(followScore, 'left', 1, 1);
    let s = startTempo(left, 1, timing);
    s = tempoNoteOn(s, 60, 1000);
    expect(s.pending.size).toBe(0);
    s = tempoTick(s, 99_999);
    expect(s.results).toEqual([]);
    expect(s.finished).toBe(true);
  });
});

describe('measure stats', () => {
  it('ranks the worst measures across runs', () => {
    const runs = [
      [
        { measure: 0, total: 4, errors: 0, offBeat: 0 },
        { measure: 1, total: 4, errors: 2, offBeat: 0 },
        { measure: 2, total: 2, errors: 2, offBeat: 0 },
      ],
      [
        { measure: 1, total: 4, errors: 1, offBeat: 2 },
        { measure: 2, total: 2, errors: 0, offBeat: 0 },
        { measure: 3, total: 0, errors: 1, offBeat: 0 },
      ],
    ];
    expect(worstMeasures(runs).map((m) => [m.measure, m.rate])).toEqual([
      [1, 0.5],
      [2, 0.5],
    ]);
    expect(measureErrorRate({ measure: 0, total: 0, errors: 1, offBeat: 0 })).toBe(1);
    expect(measureErrorRate({ measure: 0, total: 0, errors: 0, offBeat: 0 })).toBe(0);
  });
});

// ───────────────────────────── 反复记号 ─────────────────────────────

describe('playbackOrder', () => {
  const f = (over: Partial<MeasureFlow> = {}): MeasureFlow => ({ ...EMPTY_FLOW, ...over });

  it.each([
    ['|: A B :| C', [f({ repeatStart: true }), f({ repeatEnd: 2 }), f()], [0, 1, 0, 1, 2]],
    [
      '|: A B |1 C :|2 D | E',
      [f({ repeatStart: true }), f(), f({ endings: [1], repeatEnd: 2 }), f({ endings: [2] }), f()],
      [0, 1, 2, 0, 1, 3, 4],
    ],
    [
      '|: A |1,2 B :|(×3) |3 C',
      [f({ repeatStart: true }), f({ endings: [1, 2], repeatEnd: 3 }), f({ endings: [3] })],
      [0, 1, 0, 1, 0, 2],
    ],
    ['A :| B :|（没有前反复）', [f({ repeatEnd: 2 }), f({ repeatEnd: 2 })], [0, 0, 1, 1]],
    [
      'D.S. al Coda',
      [f(), f({ segno: true }), f({ toCoda: true }), f({ dalSegno: true }), f({ coda: true })],
      [0, 1, 2, 3, 1, 2, 4],
    ],
    ['D.C. al Fine', [f(), f({ fine: true }), f({ daCapo: true })], [0, 1, 2, 0, 1]],
    ['D.C. 之后不再反复', [f({ repeatEnd: 2 }), f({ daCapo: true })], [0, 0, 1, 0, 1]],
    [
      'D.C. 之后走最后一个结尾',
      [
        f({ repeatStart: true }),
        f({ endings: [1], repeatEnd: 2 }),
        f({ endings: [2], daCapo: true }),
      ],
      [0, 1, 0, 2, 0, 2],
    ],
    ['To Coda 找不到 coda 时继续', [f({ daCapo: true, toCoda: true })], [0, 0]],
    ['D.S. 没有 segno 时回到开头', [f(), f({ dalSegno: true })], [0, 1, 0, 1]],
  ])('%s', (_, flows, expected) => {
    expect(playbackOrder(flows)).toEqual(expected);
  });

  it('parses ending numbers', () => {
    expect(parseEndingNumbers('1, 2')).toEqual([1, 2]);
    expect(parseEndingNumbers('1 2')).toEqual([1, 2]);
    expect(parseEndingNumbers('x')).toEqual([]);
  });

  it('picks the measures of a practice range in playing order', () => {
    const order = [0, 1, 2, 0, 1, 3, 4];
    expect(practiceSequence(order, 0, 4, true)).toEqual(order);
    expect(practiceSequence(order, 1, 3, true)).toEqual([1, 2, 1, 3]);
    expect(practiceSequence(order, 1, 1, true)).toEqual([1]);
    expect(practiceSequence(order, 0, 4, false)).toEqual([0, 1, 2, 3, 4]);
    expect(practiceSequence([0, 1, 0, 2, 0, 2], 0, 2, true, true)).toEqual([0, 1, 0, 2, 0, 2]);
    // 2 之后再也没有 1：按谱面顺序
    expect(practiceSequence([0, 1, 2], 2, 1 + 2, true)).toEqual([2, 3]);
  });

  it('reads repeats, voltas and jumps from MusicXML and plans along the playing order', () => {
    const m = (n: number, body: string, step = 'C') =>
      `<measure number="${n}">${n === 1 ? '<attributes><divisions>1</divisions></attributes>' : ''}${body}${note(step, 4, 4)}</measure>`;
    const xml = xmlScore(
      `<part id="P">${m(1, '<barline location="left"><repeat direction="forward"/></barline><direction><direction-type><segno/></direction-type></direction>')}${m(
        2,
        '<barline location="left"><ending number="1" type="start"/></barline><barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>',
        'D',
      )}${m(3, '<barline location="left"><ending number="2" type="start"/></barline>', 'E')}${m(
        4,
        '<barline location="right"><ending number="2" type="discontinue"/></barline><sound fine="yes"/>',
        'F',
      )}${m(5, '<direction><sound dalsegno="segno"/></direction>', 'G')}</part>`,
    );
    const s = parseMusicXml(xml);
    expect(s.measures.map((x) => x.flow?.endings ?? null)).toEqual([null, [1], [2], [2], null]);
    // |: C |1 D :|2 E F | G (D.S. al Fine) → C D C E F G，跳回 segno（第 1 小节）后走第 2 结尾到 Fine
    expect(s.playback).toEqual([0, 1, 0, 2, 3, 4, 0, 2, 3]);
    expect(hasRepeats(s)).toBe(true);
    const plan = buildFollowPlan(s, 'both', 0, 4);
    expect(plan.segments.map((x) => x.measure)).toEqual(s.playback);
    expect(plan.steps.map((x) => x.notes[0]?.pitch)).toEqual([60, 62, 60, 64, 65, 67, 60, 64, 65]);
    expect(plan.steps.map((x) => x.tick)).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => k * TPQ * 4),
    );
    expect(plan.length).toBe(9 * TPQ * 4);
    const straight = buildFollowPlan(s, 'both', 0, 4, false);
    expect(straight.steps).toHaveLength(5);
    expect(hasRepeats(followScore)).toBe(false);
  });
});

// ───────────────────────────── 自动标和弦 ─────────────────────────────

describe('labelChords', () => {
  /** 每小节：右手、左手各一个全音符和弦（音名带八度，例如 'G4'）；divisions = 1 */
  const chordBar = (rh: string[], lh: string[], extra = '') => {
    const notes = (names: string[], staff: number) =>
      names
        .map((n, i) => {
          const m = /^([A-G])(#|b)?(\d)$/.exec(n) as RegExpExecArray;
          const alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
          return note(m[1] as string, Number(m[3]), 4, {
            staff,
            type: 'whole',
            chord: i > 0,
            ...(alter ? { alter } : {}),
          });
        })
        .join('');
    return `${notes(rh, 1)}<backup><duration>4</duration></backup>${lh.length ? notes(lh, 2) : '<forward><duration>4</duration></forward>'}${extra}`;
  };
  const build = (bars: string[], fifths = 0, time = '4') =>
    parseMusicXml(
      xmlScore(
        `<part id="P">${bars
          .map(
            (b, i) =>
              `<measure number="${i + 1}">${i === 0 ? `<attributes><divisions>1</divisions><key><fifths>${fifths}</fifths></key><time><beats>${time}</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>` : ''}${b}</measure>`,
          )
          .join('')}</part>`,
      ),
    );

  it('names seventh chords, inversions, and spells roots in the key', () => {
    const s = build([
      chordBar(['F4', 'A4', 'C5'], ['D3']),
      chordBar(['F4', 'B4', 'D5'], ['G2']),
      chordBar(['E4', 'G4', 'B4'], ['C3']),
      chordBar(['C4', 'E4', 'G4'], ['E3']),
      chordBar(['E5'], []),
    ]);
    const labels = labelChords(s);
    expect(labels.map((l) => l.text)).toEqual(['Dm7', 'G7', 'CM7', 'C/E']);
    expect(labels[0]).toMatchObject({ measure: 0, start: 0, end: TPQ * 4 });
    expect(labels[0]?.confidence).toBeGreaterThan(0.9);
    expect(spellInKey(10, 0)).toBe('Bb');
    expect(spellInKey(6, 2)).toBe('F#');
    expect(spellInKey(1, 3)).toBe('C#');
    expect(spellInKey(8, -3)).toBe('Ab');
    expect(spellInKey(1, -1)).toBe('Db');
  });

  it('spells chords in sharp and flat keys', () => {
    const sharp = build([chordBar(['F#4', 'A4', 'C#5'], ['F#3'])], 2);
    expect(labelChords(sharp)[0]?.text).toBe('F♯m');
    const flat = build([chordBar(['Bb4', 'D5', 'F5'], ['Bb2'])], -2);
    expect(labelChords(flat)[0]?.text).toBe('B♭');
  });

  it('splits a bar when the bass and the chord change halfway, but not 3/4 bars', () => {
    const bar = `${note('E', 4, 2, { staff: 1, type: 'half' })}${note('D', 4, 2, { staff: 1, type: 'half' })}<backup><duration>4</duration></backup>${note('C', 3, 2, { staff: 2, type: 'half' })}${note('E', 3, 2, { staff: 2, type: 'half', chord: true })}${note('G', 2, 2, { staff: 2, type: 'half' })}${note('B', 2, 2, { staff: 2, type: 'half', chord: true })}`;
    const s = build([bar]);
    expect(labelChords(s).map((l) => [l.text, l.start])).toEqual([
      ['C', 0],
      ['G', TPQ * 2],
    ]);
    const waltz = build([chordBar(['C4', 'E4', 'G4'], ['C3'])], 0, '3');
    expect(labelChords(waltz).map((l) => l.text)).toEqual(['C']);
  });

  it('builds a practice sequence in playing order, merging repeats of the same chord', () => {
    const s = build([
      chordBar(['C4', 'E4', 'G4'], ['C3']),
      chordBar(['C4', 'E4', 'G4'], ['C3']),
      chordBar(['A4', 'C5', 'E5'], ['A2']),
    ]);
    const labels = labelChords(s);
    expect(chordSequence(labels, [0, 1, 2])).toEqual(['C', 'Am']);
    expect(chordSequence(labels, [0, 2, 0, 2])).toEqual(['C', 'Am', 'C', 'Am']);
    expect(chordSequence(labels, [])).toEqual([]);
  });
});

describe('parseMusicXml：记谱细节（表情记号、连线、奏法、8va）', () => {
  const n = (step: string, octave: number, extra = '', chord = false, staff = 1) =>
    `<note>${chord ? '<chord/>' : ''}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>${extra}<staff>${staff}</staff></note>`;
  const dir = (inner: string, attrs = '', staff = 1) =>
    `<direction${attrs}><direction-type>${inner}</direction-type><staff>${staff}</staff></direction>`;
  const xml = xmlScore(
    `<part id="P1"><measure number="1">${ATTR(2, 1)}` +
      dir('<rehearsal>A</rehearsal>', ' placement="above"') +
      dir('<dynamics><mf/></dynamics>', ' placement="below"') +
      dir('<octave-shift type="down" size="8"/>') +
      n(
        'C',
        6,
        '<stem>down</stem><beam number="1">begin</beam><notations><articulations><accent/></articulations><slur type="start" number="1" placement="above"/></notations>',
      ) +
      n('E', 6, '<notations><arpeggiate/><fermata/></notations>', true) +
      n(
        'D',
        6,
        '<beam number="1">end</beam><notations><articulations><staccato/></articulations></notations>',
      ) +
      dir('<octave-shift type="stop" size="8"/>') +
      dir('<words>cresc.</words>') +
      dir('<wedge type="crescendo"/>', ' placement="below"') +
      n('E', 5, '<notations><slur type="stop" number="1"/></notations>') +
      dir('<wedge type="stop"/>') +
      n('F', 5) +
      `<backup><duration>4</duration></backup>` +
      dir('<pedal type="start"/>', '', 2) +
      n('C', 3, '', false, 2) +
      n('C', 3, '', false, 2) +
      dir('<pedal type="stop"/>', '', 2) +
      n('C', 3, '', false, 2) +
      n('C', 3, '', false, 2) +
      `</measure></part>`,
    '<score-part id="P1"><part-name>Piano</part-name></score-part>',
  );
  const s = parseMusicXml(xml);

  it('音符上的符干、符杠、奏法、琶音、连线（和弦里的音合并）', () => {
    const top = s.elements.filter((e) => e.staff === 1);
    expect(top[0]).toMatchObject({
      stem: 'down',
      beam: 'begin',
      arpeggio: true,
      articulations: ['accent', 'fermata'],
      slurs: [{ type: 'start', number: 1, placement: 'above' }],
    });
    expect(top[0]?.pitches.map((p) => p.spelled)).toEqual(['C6', 'E6']);
    expect(top[1]).toMatchObject({ beam: 'end', articulations: ['staccato'] });
    expect(top[2]?.slurs).toEqual([{ type: 'stop', number: 1 }]);
  });

  it('8va 范围里的音显示低一个八度；范围外不变', () => {
    const top = s.elements.filter((e) => e.staff === 1);
    expect(top.map((e) => e.octaveShift ?? 0)).toEqual([-1, -1, 0, 0]);
    // 演奏用的音不变（MusicXML 的 pitch 是实际音高）
    expect(s.notes.find((x) => x.start === 0 && x.hand === 'right')?.pitch).toBe(84);
  });

  it('表情记号：排练号、力度、文字、渐强、踏板、8va（按时间排序）', () => {
    expect(
      (s.directions ?? []).map((d) => [
        d.kind,
        'text' in d ? d.text : 'type' in d ? d.type : '',
        d.tick / TPQ,
        d.staff,
        d.placement,
      ]),
    ).toEqual([
      ['rehearsal', 'A', 0, 1, 'above'],
      ['dynamic', 'mf', 0, 1, 'below'],
      ['octave', 'down', 0, 1, 'above'],
      ['pedal', 'start', 0, 2, 'below'],
      ['octave', 'stop', 2, 1, 'above'],
      ['words', 'cresc.', 2, 1, 'above'],
      ['wedge', 'crescendo', 2, 1, 'below'],
      ['pedal', 'stop', 2, 2, 'below'],
      ['wedge', 'stop', 3, 1, 'below'],
    ]);
  });
});

describe('parseMusicXml：换行、换谱号、装饰音、小节线', () => {
  const n = (step: string, octave: number, extra = '', staff = 1, pre = '') =>
    `<note>${pre}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><voice>${staff}</voice><type>quarter</type>${extra}<staff>${staff}</staff></note>`;
  const grace = (step: string, octave: number, chord = false, acc = '') =>
    `<note><grace slash="yes"/>${chord ? '<chord/>' : ''}<pitch><step>${step}</step>${acc ? '<alter>1</alter>' : ''}<octave>${octave}</octave></pitch><voice>1</voice><type>16th</type>${acc}<staff>1</staff></note>`;
  const rest = (staff: number, at = '') =>
    `<note><rest>${at}</rest><duration>1</duration><voice>${staff}</voice><type>quarter</type><staff>${staff}</staff></note>`;
  const time = '<time symbol="common"><beats>4</beats><beat-type>4</beat-type></time>';
  const xml = xmlScore(
    `<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key>${time}<staves>2</staves><clef number="1"><sign>G</sign></clef><clef number="2"><sign>F</sign></clef></attributes>` +
      grace('D', 5) +
      grace('F', 5, true, '<accidental>sharp</accidental>') +
      n('C', 5) +
      n('D', 5) +
      rest(1, '<display-step>E</display-step><display-octave>5</display-octave>') +
      n('E', 5) +
      `<backup><duration>4</duration></backup>` +
      n('C', 3, '', 2) +
      n('C', 3, '', 2) +
      `<attributes><clef number="2"><sign>G</sign></clef></attributes>` +
      n('B', 4, '', 2) +
      n('A', 4, '', 2) +
      `<attributes><clef number="2"><sign>F</sign></clef></attributes>` +
      `<barline location="right"><bar-style>light-light</bar-style></barline></measure>` +
      `<measure number="2"><print new-system="yes"/>${n('C', 5)}${rest(1)}${rest(1)}${rest(1)}` +
      `<backup><duration>4</duration></backup>${n('C', 3, '', 2)}${rest(2)}${rest(2)}${rest(2)}</measure></part>`,
    '<score-part id="P1"><part-name>Piano</part-name></score-part>',
  );
  const s = parseMusicXml(xml);

  it('装饰音挂在后面的音上（和弦、斜线、写出的临时记号），不进演奏的音', () => {
    const first = s.elements.find((e) => e.staff === 1 && e.start === 0);
    expect(first?.graces).toEqual([
      { spelled: ['D5', 'F#5'], accidentals: [null, '#'], type: '16th', slash: true },
    ]);
    expect(s.notes.filter((x) => x.hand === 'right' && x.measure === 0)).toHaveLength(3);
  });

  it('小节中间换谱号：之后的音按新谱号；小节末尾换回来，下一小节开头是低音谱号', () => {
    const left = s.elements.filter((e) => e.staff === 2 && e.measure === 0);
    expect(left.map((e) => e.clef)).toEqual(['bass', 'bass', 'treble', 'treble']);
    const [m1, m2] = s.measures;
    expect(m1?.clefs).toEqual(['treble', 'bass']);
    expect(m1?.clefChanges?.map((c) => [c.staff, c.tick / TPQ, c.clef])).toEqual([
      [2, 2, 'treble'],
      [2, 4, 'bass'],
    ]);
    expect(m2?.clefs).toEqual(['treble', 'bass']);
    expect(m2?.clefChanges).toBeUndefined();
  });

  it('原谱的换行、C 拍号、双小节线、休止符位置', () => {
    const [m1, m2] = s.measures;
    expect(m1?.systemBreak).toBeUndefined();
    expect(m2?.systemBreak).toBe(true);
    expect(m1?.timeSymbol).toBe('common');
    expect(m1?.barRight).toBe('double');
    expect(m2?.barRight).toBeUndefined();
    const rests = s.elements.filter((e) => e.rest && e.measure === 0);
    expect(rests.map((e) => e.restAt)).toEqual(['E5']);
  });
});
