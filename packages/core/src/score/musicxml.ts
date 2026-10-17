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
  type ScoreDirection,
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

/** 小节内的记号：tick 相对小节开始，staff 是声部自己的谱表号 */
type PartDirection = ScoreDirection extends infer D
  ? D extends ScoreDirection
    ? Omit<D, 'measure'>
    : never
  : never;

const DYNAMICS = new Set([
  'p',
  'pp',
  'ppp',
  'pppp',
  'mp',
  'mf',
  'f',
  'ff',
  'fff',
  'ffff',
  'sf',
  'sfz',
  'sffz',
  'sfp',
  'fp',
  'fz',
  'rf',
  'rfz',
  'sfpp',
  'pf',
  'n',
]);
const ARTICULATIONS = new Set([
  'accent',
  'staccato',
  'tenuto',
  'strong-accent',
  'staccatissimo',
  'detached-legato',
]);

/** <direction> → 记号列表（一个 direction 可以有几个 direction-type） */
function readDirection(el: XmlElement, tick: number): PartDirection[] {
  const staff = childNumber(el, 'staff') ?? 1;
  const explicit = el.attrs.placement;
  const out: PartDirection[] = [];
  for (const dt of childrenNamed(el, 'direction-type')) {
    for (const c of dt.children) {
      const place = (fallback: 'above' | 'below'): 'above' | 'below' =>
        explicit === 'above' || explicit === 'below' ? explicit : fallback;
      switch (c.name) {
        case 'dynamics': {
          const names = c.children.map((d) =>
            d.name === 'other-dynamics' ? d.text.trim() : d.name,
          );
          const text = names.filter((n) => DYNAMICS.has(n) || n.length > 0).join('');
          if (text) out.push({ kind: 'dynamic', text, staff, tick, placement: place('below') });
          break;
        }
        case 'words': {
          const text = c.text.trim();
          if (text) out.push({ kind: 'words', text, staff, tick, placement: place('above') });
          break;
        }
        case 'rehearsal': {
          const text = c.text.trim();
          if (text) out.push({ kind: 'rehearsal', text, staff, tick, placement: 'above' });
          break;
        }
        case 'wedge': {
          const type = c.attrs.type;
          if (type === 'crescendo' || type === 'diminuendo' || type === 'stop') {
            out.push({ kind: 'wedge', type, staff, tick, placement: place('below') });
          }
          break;
        }
        case 'pedal': {
          const type = c.attrs.type;
          if (type === 'start' || type === 'stop' || type === 'change') {
            out.push({ kind: 'pedal', type, staff, tick, placement: 'below' });
          }
          break;
        }
        case 'octave-shift': {
          const type = c.attrs.type;
          const size = Number(c.attrs.size) || 8;
          if (type === 'up' || type === 'down' || type === 'stop') {
            // 8va（音写低了，type=down）画在上方，8vb 画在下方
            out.push({
              kind: 'octave',
              type,
              size,
              staff,
              tick,
              placement: type === 'up' ? 'below' : 'above',
            });
          }
          break;
        }
      }
    }
  }
  return out;
}

interface PartMeasure {
  number: string;
  length: number;
  beats: number | null;
  beatType: number | null;
  fifths: number | null;
  clefs: Map<number, Clef>;
  elements: NotationElement[];
  directions: PartDirection[];
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
      directions: [],
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
          const extra = readNotations(el);
          if (isChord && last && pitch && !last.rest) {
            last.pitches.push(pitch);
            mergeNotations(last, extra);
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
          mergeNotations(last, extra);
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
          pm.directions.push(
            ...readDirection(el, Math.max(0, pos + ticks(childNumber(el, 'offset')))),
          );
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

type Notations = Pick<NotationElement, 'stem' | 'beam' | 'articulations' | 'arpeggio' | 'slurs'>;

/** 往可能还没有的数组里加一项 */
function append<T>(list: T[] | undefined, item: T): T[] {
  return list ? [...list, item] : [item];
}

/** 音符上的符干、符杠、奏法、琶音、连线 */
function readNotations(el: XmlElement): Notations {
  const out: Notations = {};
  const stem = childText(el, 'stem');
  if (stem === 'up' || stem === 'down') out.stem = stem;
  const beam = childrenNamed(el, 'beam').find((b) => (b.attrs.number ?? '1') === '1');
  const beamText = beam?.text.trim();
  if (beamText === 'begin' || beamText === 'continue' || beamText === 'end') out.beam = beamText;
  for (const n of childrenNamed(el, 'notations')) {
    for (const c of n.children) {
      if (c.name === 'articulations') {
        for (const a of c.children) {
          if (ARTICULATIONS.has(a.name)) out.articulations = append(out.articulations, a.name);
        }
      } else if (c.name === 'fermata') {
        out.articulations = append(out.articulations, 'fermata');
      } else if (c.name === 'arpeggiate') {
        out.arpeggio = true;
      } else if (c.name === 'slur') {
        const type = c.attrs.type;
        if (type === 'start' || type === 'stop') {
          const placement = c.attrs.placement;
          out.slurs = append(out.slurs, {
            type,
            number: Number(c.attrs.number ?? 1) || 1,
            ...(placement === 'above' || placement === 'below' ? { placement } : {}),
          });
        }
      }
    }
  }
  return out;
}

/** 和弦里每个音的记号合并到这个音符上 */
function mergeNotations(target: NotationElement, n: Notations) {
  if (n.stem && !target.stem) target.stem = n.stem;
  if (n.beam && !target.beam) target.beam = n.beam;
  if (n.arpeggio) target.arpeggio = true;
  for (const a of n.articulations ?? []) {
    if (!target.articulations?.includes(a)) target.articulations = append(target.articulations, a);
  }
  for (const s of n.slurs ?? []) {
    if (!target.slurs?.some((x) => x.type === s.type && x.number === s.number)) {
      target.slurs = append(target.slurs, s);
    }
  }
}

/** 8va / 8vb：记号范围内、同一个谱表的音显示时移动八度 */
function applyOctaveShifts(elements: NotationElement[], directions: readonly ScoreDirection[]) {
  const open = new Map<number, { tick: number; octaves: number }>();
  const ranges: { staff: number; from: number; to: number; octaves: number }[] = [];
  for (const d of directions) {
    if (d.kind !== 'octave') continue;
    if (d.type === 'stop') {
      const o = open.get(d.staff);
      if (o) ranges.push({ staff: d.staff, from: o.tick, to: d.tick, octaves: o.octaves });
      open.delete(d.staff);
    } else {
      const octaves = Math.max(1, Math.round((d.size - 1) / 7));
      open.set(d.staff, { tick: d.tick, octaves: d.type === 'down' ? -octaves : octaves });
    }
  }
  for (const [staff, o] of open) {
    ranges.push({ staff, from: o.tick, to: Number.POSITIVE_INFINITY, octaves: o.octaves });
  }
  for (const e of elements) {
    if (e.rest) continue;
    const r = ranges.find((x) => x.staff === e.staff && e.start >= x.from && e.start < x.to);
    if (r) e.octaveShift = r.octaves;
  }
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
  const directions: ScoreDirection[] = [];
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
      for (const d of pm?.directions ?? []) {
        directions.push({
          ...d,
          measure: i,
          tick: start + Math.min(d.tick, length),
          staff: mapStaff(partIdx, d.staff),
        } as ScoreDirection);
      }
    });
    start += length;
  }

  const staffHands: Hand[] =
    staffCount === 2 ? ['right', 'left'] : [clefs[0] === 'bass' ? 'left' : 'right'];
  const notes = buildNotes(elements, staffHands);
  assignAccidentals(elements, measures);
  directions.sort((a, b) => a.tick - b.tick);
  applyOctaveShifts(elements, directions);

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
    directions,
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
