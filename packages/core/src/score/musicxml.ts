import { strFromU8, unzipSync } from 'fflate';
import { assignAccidentals, buildNotes } from './finalize';
import {
  type BarStyle,
  type Clef,
  type ClefChange,
  DURATION_TYPES,
  type DurationType,
  type GraceGroup,
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

/** <accidental> 的文字 → 'n'、'#'、'b'… */
const ACCIDENTAL_TEXT: Record<string, string> = {
  natural: 'n',
  sharp: '#',
  flat: 'b',
  'double-sharp': '##',
  'sharp-sharp': '##',
  'flat-flat': 'bb',
};

const BAR_STYLE: Record<string, BarStyle> = {
  regular: 'regular',
  'light-light': 'double',
  'light-heavy': 'final',
  'heavy-light': 'heavy-light',
  dashed: 'dashed',
  none: 'none',
};

/** <pitch> → 拼写过的音名 'Bb4' 与 MIDI 号 */
function readPitch(pitchEl: XmlElement): { spelled: string; pitch: number } {
  const step = childText(pitchEl, 'step') ?? 'C';
  const alter = Math.round(childNumber(pitchEl, 'alter') ?? 0);
  const octave = childNumber(pitchEl, 'octave') ?? 4;
  const acc = alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter);
  return {
    spelled: `${step}${acc}${octave}`,
    pitch: (octave + 1) * 12 + (STEP_PC[step] ?? 0) + alter,
  };
}

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
  /** 换谱号（tick 相对小节开始，按出现顺序） */
  clefs: { staff: number; tick: number; clef: Clef }[];
  elements: NotationElement[];
  systemBreak: boolean;
  timeSymbol: 'common' | 'cut' | null;
  barRight: BarStyle | null;
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
      clefs: [],
      elements: [],
      systemBreak: false,
      timeSymbol: null,
      barRight: null,
      directions: [],
      flow: { ...EMPTY_FLOW, endings: ending },
    };
    let endingStops = false;
    let pos = 0;
    let maxPos = 0;
    let last: NotationElement | null = null;
    /** 还没挂到主音符上的装饰音（谱表:声部 → 列表） */
    const graces = new Map<string, GraceGroup[]>();
    let lastGrace: GraceGroup | null = null;
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
            const symbol = time?.attrs.symbol;
            pm.timeSymbol = symbol === 'common' || symbol === 'cut' ? symbol : null;
          }
          for (const c of childrenNamed(el, 'clef')) {
            pm.clefs.push({
              staff: Number(c.attrs.number ?? 1),
              tick: Math.max(0, pos),
              clef: clefOf(c),
            });
          }
          break;
        }
        case 'print':
          if (el.attrs['new-system'] === 'yes' || el.attrs['new-page'] === 'yes') {
            pm.systemBreak = true;
          }
          break;
        case 'note': {
          const graceEl = child(el, 'grace');
          if (graceEl) {
            out.grace = true;
            const pitchEl = child(el, 'pitch');
            if (!pitchEl) break;
            const { spelled } = readPitch(pitchEl);
            const accText = childText(el, 'accidental');
            const acc = accText ? (ACCIDENTAL_TEXT[accText] ?? null) : null;
            if (child(el, 'chord') && lastGrace) {
              lastGrace.spelled.push(spelled);
              lastGrace.accidentals.push(acc);
              break;
            }
            const typeText = childText(el, 'type') as DurationType | undefined;
            lastGrace = {
              spelled: [spelled],
              accidentals: [acc],
              type: typeText && DURATION_TYPES.includes(typeText) ? typeText : 'eighth',
              slash: graceEl.attrs.slash === 'yes',
            };
            const key = `${childNumber(el, 'staff') ?? 1}:${childText(el, 'voice') ?? '1'}`;
            graces.set(key, [...(graces.get(key) ?? []), lastGrace]);
            break;
          }
          lastGrace = null;
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
                const { spelled, pitch } = readPitch(pitchEl);
                return {
                  pitch,
                  spelled,
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
          const voice = childText(el, 'voice') ?? '1';
          const restEl = child(el, 'rest');
          const restStep = childText(restEl, 'display-step');
          const restOctave = childText(restEl, 'display-octave');
          const graceKey = `${staff}:${voice}`;
          const before = graces.get(graceKey);
          graces.delete(graceKey);
          last = {
            measure: out.measures.length,
            staff,
            voice,
            start,
            dur,
            rest: !pitch,
            type,
            dots,
            tuplet,
            pitches: pitch ? [pitch] : [],
            ...(before && pitch ? { graces: before } : {}),
            ...(!pitch && restStep && restOctave ? { restAt: `${restStep}${restOctave}` } : {}),
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
          const style = BAR_STYLE[childText(el, 'bar-style') ?? ''];
          if (style && (el.attrs.location ?? 'right') === 'right') pm.barRight = style;
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
    const timeLength = Math.round((beats * 4 * TPQ) / beatType);
    const contentLength = Math.max(0, ...pms.map((pm) => pm?.length ?? 0));
    const length = contentLength > 0 ? contentLength : timeLength;
    // 谱号：小节开头的直接生效；小节中间的记为换谱号，之后的音按新谱号画
    const events: ClefChange[] = [];
    pms.forEach((pm, partIdx) => {
      for (const c of pm?.clefs ?? []) {
        // 钢琴声部的第 3 行以后不改第 2 行的谱号
        if (grand && c.staff > 2) continue;
        events.push({ staff: mapStaff(partIdx, c.staff), tick: c.tick, clef: c.clef });
      }
    });
    for (const c of events) if (c.tick === 0) clefs[c.staff - 1] = c.clef;
    const startClefs = [...clefs];
    const changes = events
      .filter((c) => c.tick > 0)
      .sort((a, b) => a.tick - b.tick)
      .map((c) => ({ ...c, tick: start + c.tick }));
    const clefAt = (staff: number, tick: number): Clef => {
      let clef = startClefs[staff - 1] ?? 'treble';
      for (const c of changes) if (c.staff === staff && c.tick <= tick) clef = c.clef;
      return clef;
    };
    for (const c of changes) clefs[c.staff - 1] = c.clef;
    const breakHere = pms.some((pm) => pm?.systemBreak) && i > 0;
    const timeSymbol = first.timeSymbol;
    const barRight = pms.find((pm) => pm?.barRight)?.barRight;
    measures.push({
      index: i,
      number: first.number,
      start,
      length,
      beats,
      beatType,
      fifths,
      clefs: startClefs,
      flow: first.flow,
      ...(breakHere ? { systemBreak: true } : {}),
      ...(timeSymbol ? { timeSymbol } : {}),
      ...(barRight ? { barRight } : {}),
      ...(changes.some((c) => c.tick < start + length) ? { clefChanges: changes } : {}),
    });
    pms.forEach((pm, partIdx) => {
      for (const el of pm?.elements ?? []) {
        const staff = mapStaff(partIdx, el.staff);
        const at = start + el.start;
        elements.push({ ...el, start: at, staff, clef: clefAt(staff, at) });
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
