import { strFromU8, unzipSync } from 'fflate';
import { assignAccidentals, buildNotes } from './finalize';
import {
  type Clef,
  DURATION_TYPES,
  type DurationType,
  type Hand,
  type NotationElement,
  type NotationPitch,
  type Score,
  type ScoreMeasure,
  type ScoreWarning,
  TPQ,
  ticksToType,
} from './model';
import {
  EMPTY_FLOW,
  hasFlow,
  type MeasureFlow,
  parseEndingNumbers,
  playbackOrder,
} from './repeats';
import { child, childNumber, childrenNamed, childText, parseXml, type XmlElement } from './xml';

export class ScoreImportError extends Error {
  constructor(
    readonly code:
      | 'xml'
      | 'not-musicxml'
      | 'timewise'
      | 'no-notes'
      | 'mxl'
      | 'midi'
      | 'midi-format'
      | 'unknown-format',
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ScoreImportError';
  }
}

const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function clefOf(el: XmlElement): Clef {
  const sign = childText(el, 'sign');
  if (sign === 'F') return 'bass';
  if (sign === 'C') return 'alto';
  return 'treble';
}

interface PartMeasure {
  number: string;
  length: number;
  beats: number | null;
  beatType: number | null;
  fifths: number | null;
  clefs: Map<number, Clef>;
  elements: NotationElement[];
  flow: MeasureFlow;
}

interface ParsedPart {
  id: string;
  staves: number;
  measures: PartMeasure[];
  pitched: boolean;
  tempos: number[];
  grace: boolean;
}

function parsePart(part: XmlElement): ParsedPart {
  let divisions = 1;
  let staves = 1;
  const out: ParsedPart = {
    id: part.attrs.id ?? '',
    staves: 1,
    measures: [],
    pitched: false,
    tempos: [],
    grace: false,
  };
  /** 跳房子：还没结束的结尾编号 */
  let ending: number[] | null = null;
  for (const m of childrenNamed(part, 'measure')) {
    const pm: PartMeasure = {
      number: m.attrs.number ?? String(out.measures.length + 1),
      length: 0,
      beats: null,
      beatType: null,
      fifths: null,
      clefs: new Map(),
      elements: [],
      flow: { ...EMPTY_FLOW, endings: ending },
    };
    let endingStops = false;
    let pos = 0;
    let maxPos = 0;
    let last: NotationElement | null = null;
    const ticks = (d: number | undefined) => Math.round(((d ?? 0) * TPQ) / divisions);
    for (const el of m.children) {
      switch (el.name) {
        case 'attributes': {
          divisions = childNumber(el, 'divisions') ?? divisions;
          staves = childNumber(el, 'staves') ?? staves;
          const key = child(el, 'key');
          const fifths = childNumber(key, 'fifths');
          if (fifths !== undefined) pm.fifths = fifths;
          const time = child(el, 'time');
          const beats = childText(time, 'beats');
          const beatType = childNumber(time, 'beat-type');
          if (beats && beatType) {
            // 复合拍号 "3+2" 取和
            pm.beats = beats.split('+').reduce((s, x) => s + (Number(x) || 0), 0);
            pm.beatType = beatType;
          }
          for (const c of childrenNamed(el, 'clef')) {
            pm.clefs.set(Number(c.attrs.number ?? 1), clefOf(c));
          }
          break;
        }
        case 'note': {
          if (child(el, 'grace')) {
            out.grace = true;
            break;
          }
          const isChord = child(el, 'chord') !== undefined;
          const dur = ticks(childNumber(el, 'duration'));
          const start: number = isChord && last ? last.start : pos;
          if (!isChord) pos += dur;
          maxPos = Math.max(maxPos, pos);
          if (child(el, 'cue')) break;
          const staff = childNumber(el, 'staff') ?? 1;
          const pitchEl = child(el, 'pitch');
          const tieTypes = childrenNamed(el, 'tie').map((t) => t.attrs.type);
          const pitch: NotationPitch | null = pitchEl
            ? (() => {
                const step = childText(pitchEl, 'step') ?? 'C';
                const alter = Math.round(childNumber(pitchEl, 'alter') ?? 0);
                const octave = childNumber(pitchEl, 'octave') ?? 4;
                const acc = alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter);
                return {
                  pitch: (octave + 1) * 12 + (STEP_PC[step] ?? 0) + alter,
                  spelled: `${step}${acc}${octave}`,
                  noteId: -1,
                  tieStart: tieTypes.includes('start'),
                  tieStop: tieTypes.includes('stop'),
                  accidental: null,
                };
              })()
            : null;
          if (pitch) out.pitched = true;
          if (isChord && last && pitch && !last.rest) {
            last.pitches.push(pitch);
            break;
          }
          const typeText = childText(el, 'type') as DurationType | undefined;
          const tm = child(el, 'time-modification');
          const actual = childNumber(tm, 'actual-notes');
          const normal = childNumber(tm, 'normal-notes');
          const tuplet = actual && normal && actual !== normal ? { actual, normal } : null;
          const derived = ticksToType(dur);
          const type =
            typeText && DURATION_TYPES.includes(typeText) ? typeText : (derived?.type ?? 'whole');
          const dots = typeText ? childrenNamed(el, 'dot').length : (derived?.dots ?? 0);
          last = {
            measure: out.measures.length,
            staff,
            voice: childText(el, 'voice') ?? '1',
            start,
            dur,
            rest: !pitch,
            type,
            dots,
            tuplet,
            pitches: pitch ? [pitch] : [],
          };
          pm.elements.push(last);
          break;
        }
        case 'backup':
          pos -= ticks(childNumber(el, 'duration'));
          break;
        case 'forward':
          pos += ticks(childNumber(el, 'duration'));
          maxPos = Math.max(maxPos, pos);
          break;
        case 'direction':
          for (const s of childrenNamed(el, 'sound')) readSound(s, out.tempos, pm.flow);
          for (const dt of childrenNamed(el, 'direction-type')) {
            if (child(dt, 'segno')) pm.flow.segno = true;
            if (child(dt, 'coda')) pm.flow.coda = true;
          }
          break;
        case 'sound':
          readSound(el, out.tempos, pm.flow);
          break;
        case 'barline': {
          const repeat = child(el, 'repeat');
          if (repeat?.attrs.direction === 'forward') pm.flow.repeatStart = true;
          if (repeat?.attrs.direction === 'backward') {
            pm.flow.repeatEnd = Math.max(2, Number(repeat.attrs.times) || 2);
          }
          const end = child(el, 'ending');
          if (end) {
            const nums = parseEndingNumbers(end.attrs.number ?? '');
            if (end.attrs.type === 'start') {
              ending = nums.length ? nums : [1];
              pm.flow.endings = ending;
            } else {
              if (!pm.flow.endings && nums.length) pm.flow.endings = nums;
              endingStops = true;
            }
          }
          if (child(el, 'segno')) pm.flow.segno = true;
          if (child(el, 'coda')) pm.flow.coda = true;
          break;
        }
      }
    }
    pm.length = maxPos;
    if (endingStops) ending = null;
    out.measures.push(pm);
  }
  out.staves = staves;
  return out;
}

/** <sound>：速度和跳转（D.C.、D.S.、segno、coda、To Coda、Fine） */
function readSound(sound: XmlElement, tempos: number[], flow: MeasureFlow) {
  const a = sound.attrs;
  const tempo = Number(a.tempo);
  if (Number.isFinite(tempo) && tempo > 0) tempos.push(tempo);
  if (a.dacapo === 'yes') flow.daCapo = true;
  if (a.dalsegno) flow.dalSegno = true;
  if (a.segno) flow.segno = true;
  if (a.coda) flow.coda = true;
  if (a.tocoda) flow.toCoda = true;
  if (a.fine) flow.fine = true;
}

/** 解析未压缩的 MusicXML（score-partwise）。 */
export function parseMusicXml(text: string, fallbackTitle = ''): Score {
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch (err) {
    throw new ScoreImportError('xml', err instanceof Error ? err.message : undefined);
  }
  if (root.name === 'score-timewise') throw new ScoreImportError('timewise');
  if (root.name !== 'score-partwise') throw new ScoreImportError('not-musicxml');

  const names = new Map<string, string>();
  for (const sp of childrenNamed(child(root, 'part-list'), 'score-part')) {
    names.set(sp.attrs.id ?? '', childText(sp, 'part-name') ?? sp.attrs.id ?? '');
  }
  const parts = childrenNamed(root, 'part').map(parsePart);
  const pitched = parts.filter((p) => p.pitched);
  if (pitched.length === 0) throw new ScoreImportError('no-notes');

  // 选声部：第一个有两行谱表的（钢琴）；否则前两个有音的声部当作右手、左手
  const grand = pitched.find((p) => p.staves >= 2);
  const chosen = grand ? [grand] : pitched.slice(0, 2);
  const warnings: ScoreWarning[] = [];
  const ignored = pitched.filter((p) => !chosen.includes(p));
  if (ignored.length) {
    warnings.push({ kind: 'parts-ignored', parts: ignored.map((p) => names.get(p.id) ?? p.id) });
  }

  // 统一成谱表 1、2：钢琴声部的第 3 行以后并到第 2 行
  const staffCount = grand ? 2 : chosen.length;
  const mapStaff = (partIdx: number, staff: number) => (grand ? Math.min(staff, 2) : partIdx + 1);

  const measureCount = Math.max(...chosen.map((p) => p.measures.length));
  const measures: ScoreMeasure[] = [];
  const elements: NotationElement[] = [];
  let start = 0;
  let beats = 4;
  let beatType = 4;
  let fifths = 0;
  const clefs: Clef[] = Array.from({ length: staffCount }, (_, i) => (i === 0 ? 'treble' : 'bass'));
  for (let i = 0; i < measureCount; i++) {
    const pms = chosen.map((p) => p.measures[i]);
    const first = pms.find((x) => x !== undefined) as PartMeasure;
    beats = first.beats ?? beats;
    beatType = first.beatType ?? beatType;
    fifths = first.fifths ?? fifths;
    pms.forEach((pm, partIdx) => {
      for (const [n, clef] of pm?.clefs ?? []) {
        const s = mapStaff(partIdx, n);
        // 钢琴声部的第 3 行以后不改第 2 行的谱号
        if (grand && n > 2) continue;
        clefs[s - 1] = clef;
      }
    });
    const timeLength = Math.round((beats * 4 * TPQ) / beatType);
    const contentLength = Math.max(0, ...pms.map((pm) => pm?.length ?? 0));
    const length = contentLength > 0 ? contentLength : timeLength;
    measures.push({
      index: i,
      number: first.number,
      start,
      length,
      beats,
      beatType,
      fifths,
      clefs: [...clefs],
      flow: first.flow,
    });
    pms.forEach((pm, partIdx) => {
      for (const el of pm?.elements ?? []) {
        elements.push({ ...el, start: start + el.start, staff: mapStaff(partIdx, el.staff) });
      }
    });
    start += length;
  }

  const staffHands: Hand[] =
    staffCount === 2 ? ['right', 'left'] : [clefs[0] === 'bass' ? 'left' : 'right'];
  const notes = buildNotes(elements, staffHands);
  assignAccidentals(elements, measures);

  const realTempos = chosen.flatMap((p) => p.tempos);
  const flows = measures.map((m) => m.flow);
  if (new Set(realTempos).size > 1) warnings.push({ kind: 'tempo-changes' });
  if (chosen.some((p) => p.grace)) warnings.push({ kind: 'grace-notes' });
  if (notes.length === 0) throw new ScoreImportError('no-notes');

  const work = child(root, 'work');
  const title = childText(work, 'work-title') || childText(root, 'movement-title') || fallbackTitle;
  const composer =
    childrenNamed(child(root, 'identification'), 'creator')
      .find((c) => c.attrs.type === 'composer')
      ?.text.trim() || null;

  return {
    title,
    composer,
    format: 'musicxml',
    staves: staffCount,
    staffHands,
    measures,
    notes,
    elements,
    tempo: Math.round(realTempos[0] ?? 120),
    tempoMarked: realTempos.length > 0,
    playback: hasFlow(flows) ? playbackOrder(flows) : measures.map((m) => m.index),
    warnings,
  };
}

/** 从 .mxl（zip）里取出主乐谱的 MusicXML 文本。 */
export function extractMxl(data: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch (err) {
    throw new ScoreImportError('mxl', err instanceof Error ? err.message : undefined);
  }
  let path: string | undefined;
  const container = files['META-INF/container.xml'];
  if (container) {
    try {
      const root = parseXml(strFromU8(container));
      path = childrenNamed(child(root, 'rootfiles'), 'rootfile')[0]?.attrs['full-path'];
    } catch {
      path = undefined;
    }
  }
  path ??= Object.keys(files).find(
    (f) => !f.startsWith('META-INF/') && /\.(xml|musicxml)$/i.test(f),
  );
  const file = path ? files[path] : undefined;
  if (!file) throw new ScoreImportError('mxl', 'no score file');
  return strFromU8(file);
}
