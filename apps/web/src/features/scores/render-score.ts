import {
  type Clef,
  type DurationType,
  type NotationElement,
  type Score,
  type ScoreDirection,
  type ScoreMeasure,
  splitTicks,
} from '@mayochord/core';
import {
  Accidental,
  Articulation,
  BarlineType,
  Beam,
  ClefNote,
  Curve,
  Dot,
  Formatter,
  GhostNote,
  GraceNote,
  GraceNoteGroup,
  Modifier,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  StaveTie,
  Stem,
  type Tickable,
  Tuplet,
  Voice,
  VoltaType,
} from 'vexflow/bravura';
import { rowY, type StaffSpace, staffSpaces, systemLayout } from './score-layout';

/**
 * 用 VexFlow 把整首曲子排成若干行（每行若干小节），画成一个 SVG。
 * - 横向：小节宽度按音符数估计，再拉伸填满一行（最后一行太空时不拉伸）。
 * - 竖向：每一行按实际最高、最低的音和表情记号算高度（score-layout.ts），不会互相重叠。
 * - MusicXML 的记谱细节：符干方向、符杠连法、奏法、琶音、连线、力度、渐强渐弱、文字、
 *   排练号、踏板、8va/8vb（范围里的音按谱上的八度显示）、原谱的换行、小节中间换谱号、装饰音、
 *   休止符位置、C 拍号、双小节线与反复记号、跳房子。MIDI 没有这些信息。
 * 只在曲谱页面懒加载。
 */

const CODE: Record<DurationType, string> = {
  whole: 'w',
  half: 'h',
  quarter: 'q',
  eighth: '8',
  '16th': '16',
  '32nd': '32',
  '64th': '64',
};

const MAJOR_KEYS = [
  'Cb',
  'Gb',
  'Db',
  'Ab',
  'Eb',
  'Bb',
  'F',
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F#',
  'C#',
];
const keyName = (fifths: number) => MAJOR_KEYS[Math.max(-7, Math.min(7, fifths)) + 7] as string;

const REST_KEY: Record<string, string> = { treble: 'b/4', bass: 'd/3', alto: 'c/4' };

const ARTICULATION_CODE: Record<string, string> = {
  accent: 'a>',
  staccato: 'a.',
  tenuto: 'a-',
  'strong-accent': 'a^',
  staccatissimo: 'av',
  'detached-legato': 'a-',
};

/** 这个小节结束时每个谱表的谱号（小节中间换过谱号时是最后一个） */
function endClef(m: ScoreMeasure, s: number): Clef {
  let clef = m.clefs[s] ?? (s === 0 ? 'treble' : 'bass');
  for (const c of m.clefChanges ?? []) if (c.staff === s + 1) clef = c.clef;
  return clef;
}

function timeSig(m: ScoreMeasure): string {
  if (m.timeSymbol === 'common' && m.beats === 4 && m.beatType === 4) return 'C';
  if (m.timeSymbol === 'cut' && m.beats === 2 && m.beatType === 2) return 'C|';
  return `${m.beats}/${m.beatType}`;
}

/** 'Bb4' → 'bb/4'（VexFlow 只用字母和八度定位，临时记号另外加）；shift = 显示时移动的八度 */
function vexKey(spelled: string, shift = 0): string {
  const m = /^([A-G])([#b]*)(-?\d+)$/.exec(spelled);
  if (!m) return 'c/4';
  return `${(m[1] as string).toLowerCase()}${m[2]}/${Number(m[3]) + shift}`;
}

const SYSTEM_GAP = 14;
const TOP = 6;
/** VexFlow 的 Stave 默认在第一线之上留 4 个线距 */
const STAVE_PAD = 40;

export interface MeasureBox {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 音符区域开始的 x（谱号、调号之后） */
  noteX: number;
  /** 和弦名的底边 y（在这一行最高的音和记号之上） */
  labelY: number;
}

export interface ScoreLayout {
  width: number;
  height: number;
  /** 每个小节的位置（叠加高亮、点击用） */
  measures: MeasureBox[];
  /** 演奏音 id → 画出来的音符（SVG 组） */
  noteEls: Map<number, Element[]>;
  /** 谱面 tick → 这个时刻的音符的 x（标和弦名用） */
  tickX: Map<number, number>;
}

type Ctx = ReturnType<Renderer['getContext']>;

function measureMinWidth(score: Score, els: NotationElement[]): number {
  let widest = 0;
  for (let s = 1; s <= score.staves; s++) {
    const mine = els.filter((e) => e.staff === s);
    const acc = mine.reduce((n, e) => n + e.pitches.filter((p) => p.accidental).length, 0);
    const dots = mine.reduce((n, e) => n + e.dots, 0);
    const arps = mine.filter((e) => e.arpeggio).length;
    // 不同声部同时开始的音只占一个位置
    const slots = new Set(mine.map((e) => e.start)).size;
    widest = Math.max(widest, slots * 26 + acc * 9 + dots * 5 + arps * 10);
  }
  return Math.max(70, 26 + widest);
}

function headerWidth(m: ScoreMeasure, withTime: boolean): number {
  return 34 + Math.abs(m.fifths) * 10 + (withTime ? 26 : 0) + 6;
}

/**
 * 等音乐字体（Bravura）加载完再排版：VexFlow 按字形宽度排音符，字体没加载时量出来的宽度不对，
 * 符头和符干会错开。
 */
export async function fontsReady(): Promise<void> {
  try {
    await Promise.all([document.fonts.load('30pt Bravura'), document.fonts.load('12pt Academico')]);
  } catch {
    // 字体加载失败也照样画
  }
}

interface Placed {
  note: StaveNote;
  line: number;
}

export function renderScore(el: HTMLElement, score: Score, width: number): ScoreLayout {
  el.replaceChildren();
  const renderer = new Renderer(el as HTMLDivElement, Renderer.Backends.SVG);
  const ctx = renderer.getContext();
  ctx.setFillStyle('currentColor');
  ctx.setStrokeStyle('currentColor');

  const staves = score.staves;
  const x0 = staves > 1 ? 28 : 10;
  const available = Math.max(200, width - x0 - 10);
  const directions = score.directions ?? [];

  const byMeasure = new Map<number, NotationElement[]>();
  for (const e of score.elements) {
    const list = byMeasure.get(e.measure);
    if (list) list.push(e);
    else byMeasure.set(e.measure, [e]);
  }
  const timeChanged = (i: number) => {
    const m = score.measures[i] as ScoreMeasure;
    const prev = score.measures[i - 1];
    return !prev || prev.beats !== m.beats || prev.beatType !== m.beatType;
  };

  // 分行：原谱写了换行就照着换（放不下时再自动换行）；否则按宽度自动换行
  const followBreaks = score.measures.some((m) => m.systemBreak);
  type Line = { measures: number[]; widths: number[] };
  const lines: Line[] = [];
  let line: Line = { measures: [], widths: [] };
  let used = 0;
  score.measures.forEach((m, i) => {
    const body = measureMinWidth(score, byMeasure.get(i) ?? []);
    const first = line.measures.length === 0;
    const w = body + (first ? headerWidth(m, timeChanged(i)) : timeChanged(i) ? 30 : 0);
    const forced = followBreaks && m.systemBreak === true;
    // 照着原谱换行时允许稍微挤一点
    const limit = followBreaks ? available * 1.15 : available;
    if (!first && (forced || used + w > limit)) {
      lines.push(line);
      line = { measures: [], widths: [] };
      const head = body + headerWidth(m, timeChanged(i));
      line.measures.push(i);
      line.widths.push(head);
      used = head;
      return;
    }
    line.measures.push(i);
    line.widths.push(w);
    used += w;
  });
  if (line.measures.length) lines.push(line);

  // 每一行的竖直排版
  const layouts = lines.map((ln) => {
    const els = ln.measures.flatMap((mi) => byMeasure.get(mi) ?? []);
    const set = new Set(ln.measures);
    const dirs = directions.filter((d) => set.has(d.measure));
    const firstMeasure = score.measures[ln.measures[0] as number] as ScoreMeasure;
    const spaces = staffSpaces(els, dirs, firstMeasure.clefs, staves);
    return { spaces, ...systemLayout(spaces) };
  });
  const tops: number[] = [];
  let cursor = TOP;
  for (const l of layouts) {
    tops.push(cursor);
    cursor += l.height + SYSTEM_GAP;
  }
  const height = cursor;
  renderer.resize(width, height);

  const boxes: MeasureBox[] = [];
  const noteOf = new Map<NotationElement, Placed>();
  const lastIndex = score.measures.length - 1;

  lines.forEach((ln, li) => {
    const lay = layouts[li] as (typeof layouts)[number];
    const sysTop = tops[li] as number;
    const total = ln.widths.reduce((a, b) => a + b, 0);
    const isLast = li === lines.length - 1;
    const stretch = isLast && total < available * 0.6 && !followBreaks ? 1 : available / total;
    let x = x0;
    ln.measures.forEach((mi, pos) => {
      const m = score.measures[mi] as ScoreMeasure;
      const w = (ln.widths[pos] as number) * stretch;
      const prev = score.measures[mi - 1];
      const staveList: Stave[] = [];
      for (let s = 0; s < staves; s++) {
        const stave = new Stave(x, sysTop + (lay.lineY[s] as number) - STAVE_PAD, w);
        const clef = m.clefs[s] ?? (s === 0 ? 'treble' : 'bass');
        if (pos === 0) {
          stave.addClef(clef);
          stave.addKeySignature(keyName(m.fifths));
        } else {
          // 上一个小节结尾换了谱号（或这个小节开头换）：小号谱号
          if (prev && endClef(prev, s) !== clef) stave.addClef(clef, 'small');
          if (prev && prev.fifths !== m.fifths) {
            stave.addKeySignature(keyName(m.fifths), keyName(prev.fifths));
          }
        }
        if (timeChanged(mi)) stave.addTimeSignature(timeSig(m));
        stave.setBegBarType(m.flow?.repeatStart ? BarlineType.REPEAT_BEGIN : BarlineType.SINGLE);
        stave.setEndBarType(endBar(m, mi === lastIndex));
        if (s === 0) {
          const volta = voltaOf(score.measures, mi);
          if (volta) stave.setVoltaType(volta.type, volta.label, -4);
        }
        stave.setContext(ctx).draw();
        staveList.push(stave);
      }
      const top = staveList[0] as Stave;
      const bottom = staveList[staveList.length - 1] as Stave;
      if (staves > 1) {
        if (pos === 0) {
          for (const type of ['brace', 'singleLeft'] as const) {
            new StaveConnector(top, bottom).setType(type).setContext(ctx).draw();
          }
        }
        const bar = endBar(m, mi === lastIndex);
        new StaveConnector(top, bottom)
          .setType(
            bar === BarlineType.END || bar === BarlineType.REPEAT_END
              ? 'boldDoubleRight'
              : bar === BarlineType.DOUBLE
                ? 'thinDouble'
                : 'singleRight',
          )
          .setContext(ctx)
          .draw();
        if (m.flow?.repeatStart && pos > 0) {
          new StaveConnector(top, bottom).setType('boldDoubleLeft').setContext(ctx).draw();
        }
      }
      // 每行开头标小节号
      if (pos === 0) {
        text(ctx, m.number, x, top.getYForLine(0) - 10, { size: 10, style: 'italic' });
      }
      const box: MeasureBox = {
        index: mi,
        x,
        y: top.getYForLine(0) - 14,
        w,
        h: bottom.getYForLine(4) - top.getYForLine(0) + 28,
        noteX: x,
        labelY: sysTop + lay.labelY,
      };
      boxes.push(box);
      const placed: [NotationElement, StaveNote][] = [];
      try {
        box.noteX = drawMeasure(m, byMeasure.get(mi) ?? [], staveList, ctx, (e, note) =>
          placed.push([e, note]),
        );
        for (const [e, note] of placed) noteOf.set(e, { note, line: li });
      } catch (err) {
        // 一个小节画不出来时只空着这个小节，不影响后面的
        console.warn(`measure ${m.number} failed to render`, err);
      }
      x += w;
    });
  });

  drawTies(score, noteOf, ctx);
  drawSlurs(score, noteOf, ctx);

  // 表情记号：每个记号的 x 取这个时刻的音符（没有音符时按小节里的位置估计）
  const xAt = (d: { measure: number; tick: number }) => tickToX(score, boxes, noteOf, d);
  lines.forEach((ln, li) => {
    const lay = layouts[li] as (typeof layouts)[number];
    const set = new Set(ln.measures);
    const lineDirs = directions.filter((d) => set.has(d.measure));
    const sysTop = tops[li] as number;
    const first = boxes.find((b) => b.index === ln.measures[0]) as MeasureBox;
    const lastBox = boxes.find(
      (b) => b.index === ln.measures[ln.measures.length - 1],
    ) as MeasureBox;
    drawDirections(ctx, lineDirs, directions, {
      spaces: lay.spaces,
      lineY: lay.lineY.map((y) => sysTop + y),
      xAt,
      left: first.noteX,
      right: lastBox.x + lastBox.w - 4,
      measures: set,
    });
  });

  const noteEls = new Map<number, Element[]>();
  const tickX = new Map<number, number>();
  for (const [e, { note }] of noteOf) {
    const nx = note.getAbsoluteX();
    tickX.set(e.start, Math.min(tickX.get(e.start) ?? nx, nx));
    const g = note.getSVGElement();
    if (!g) continue;
    for (const p of e.pitches) {
      const list = noteEls.get(p.noteId);
      if (list) list.push(g);
      else noteEls.set(p.noteId, [g]);
    }
  }

  const svg = el.querySelector('svg');
  if (svg) {
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('aria-hidden', 'true');
  }
  return { width, height, measures: boxes, noteEls, tickX };
}

/** 小节结尾的小节线：反复记号优先，其次谱上的样式 */
function endBar(m: ScoreMeasure, last: boolean): number {
  if (m.flow?.repeatEnd) return BarlineType.REPEAT_END;
  switch (m.barRight) {
    case 'double':
      return BarlineType.DOUBLE;
    case 'final':
      return BarlineType.END;
    case 'none':
      return BarlineType.NONE;
  }
  return last ? BarlineType.END : BarlineType.SINGLE;
}

/** 跳房子的括号：同一组结尾编号连续的小节画成一个 */
function voltaOf(
  measures: readonly ScoreMeasure[],
  i: number,
): { type: number; label: string } | null {
  const key = (k: number) => measures[k]?.flow?.endings?.join(',') ?? null;
  const own = key(i);
  if (!own) return null;
  const begins = key(i - 1) !== own;
  const ends = key(i + 1) !== own;
  const label = `${own}.`;
  if (begins && ends) return { type: VoltaType.BEGIN_END, label };
  if (begins) return { type: VoltaType.BEGIN, label };
  if (ends) return { type: VoltaType.END, label: '' };
  return { type: VoltaType.MID, label: '' };
}

function text(
  ctx: Ctx,
  s: string,
  x: number,
  y: number,
  opts: { size?: number; weight?: string; style?: string; family?: string } = {},
) {
  ctx.save();
  ctx.setFont(
    opts.family ?? 'Academico, serif',
    opts.size ?? 13,
    opts.weight ?? 'normal',
    opts.style ?? 'normal',
  );
  ctx.fillText(s, x, y);
  ctx.restore();
}

/** 谱面 tick → x：这个时刻有音符就用它的位置，否则在小节里按比例估计 */
function tickToX(
  score: Score,
  boxes: readonly MeasureBox[],
  noteOf: ReadonlyMap<NotationElement, Placed>,
  d: { measure: number; tick: number },
): number {
  let best: number | null = null;
  for (const [e, { note }] of noteOf) {
    if (e.measure === d.measure && e.start === d.tick) {
      const nx = note.getAbsoluteX();
      best = best === null ? nx : Math.min(best, nx);
    }
  }
  if (best !== null) return best;
  const box = boxes.find((b) => b.index === d.measure);
  const m = score.measures[d.measure];
  if (!box || !m) return 0;
  const frac = m.length > 0 ? (d.tick - m.start) / m.length : 0;
  return box.noteX + Math.max(0, Math.min(1, frac)) * (box.x + box.w - box.noteX - 8);
}

interface LineGeometry {
  spaces: StaffSpace[];
  lineY: number[];
  xAt: (d: { measure: number; tick: number }) => number;
  left: number;
  right: number;
  measures: ReadonlySet<number>;
}

/** 一行里的力度、文字、排练号、渐强渐弱、踏板、8va */
function drawDirections(
  ctx: Ctx,
  dirs: readonly ScoreDirection[],
  all: readonly ScoreDirection[],
  g: LineGeometry,
) {
  const yFor = (d: ScoreDirection, kind: Parameters<typeof rowY>[3]) => {
    const s = d.staff - 1;
    return rowY(g.spaces[s] as StaffSpace, g.lineY[s] as number, d.placement, kind);
  };
  /** 跨行的记号：找到它的结束（同谱表、同种类的 stop），这一行里画到行尾 */
  const endOf = (d: ScoreDirection, isStop: (x: ScoreDirection) => boolean) => {
    const stop = all.find((x) => x.staff === d.staff && x.tick >= d.tick && x !== d && isStop(x));
    if (!stop) return g.right;
    return g.measures.has(stop.measure) ? g.xAt(stop) : g.right;
  };

  for (const d of dirs) {
    const x = g.xAt(d);
    switch (d.kind) {
      case 'dynamic':
        text(ctx, d.text, x - 4, yFor(d, 'dynamic'), { size: 15, weight: 'bold', style: 'italic' });
        break;
      case 'words':
        text(ctx, d.text, x, yFor(d, 'words'), { size: 13, style: 'italic' });
        break;
      case 'rehearsal': {
        const y = yFor(d, 'rehearsal');
        const w = 8 + d.text.length * 10;
        ctx.save();
        ctx.setLineWidth(1.2);
        ctx.beginPath();
        ctx.rect(x - 4, y - 16, w, 20);
        ctx.stroke();
        ctx.restore();
        text(ctx, d.text, x, y, { size: 15, weight: 'bold' });
        break;
      }
      case 'wedge': {
        if (d.type === 'stop') break;
        const end = endOf(d, (s) => s.kind === 'wedge' && s.type === 'stop');
        const y = yFor(d, 'dynamic') - 5;
        const [open, close] = d.type === 'crescendo' ? [x, end] : [end, x];
        ctx.save();
        ctx.setLineWidth(1);
        ctx.beginPath();
        ctx.moveTo(close, y - 5);
        ctx.lineTo(open, y);
        ctx.lineTo(close, y + 5);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'pedal': {
        const y = yFor(d, 'pedal');
        if (d.type === 'stop') text(ctx, '*', x, y, { size: 16 });
        else text(ctx, 'Ped.', x - 4, y, { size: 13, style: 'italic', weight: 'bold' });
        break;
      }
      case 'octave': {
        if (d.type === 'stop') break;
        const end = endOf(d, (s) => s.kind === 'octave' && s.type === 'stop');
        const y = yFor(d, 'octave');
        const label = d.size >= 15 ? '15' : '8';
        const suffix = d.type === 'down' ? 'va' : 'vb';
        text(ctx, label, x, y, { size: 14, weight: 'bold', style: 'italic' });
        text(ctx, suffix, x + 9, y - 4, { size: 9, style: 'italic' });
        ctx.save();
        ctx.setLineWidth(1);
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        const ly = y - 5;
        ctx.moveTo(x + 22, ly);
        ctx.lineTo(end, ly);
        ctx.lineTo(end, d.placement === 'above' ? ly + 6 : ly - 6);
        ctx.stroke();
        ctx.restore();
        break;
      }
    }
  }
}

function drawMeasure(
  m: ScoreMeasure,
  els: NotationElement[],
  staveList: Stave[],
  ctx: Ctx,
  register: (e: NotationElement, note: StaveNote) => void,
): number {
  const voices: { voice: Voice; stave: Stave }[] = [];
  const beams: Beam[] = [];
  const tuplets: Tuplet[] = [];
  /** 琶音自己画（VexFlow 的 Stroke 会读取同一时刻其他谱表上还没排好的音，报错） */
  const arpeggios: { note: StaveNote; acc: boolean }[] = [];
  const groups = Beam.getDefaultBeamGroups(`${m.beats}/${m.beatType}`);

  const end = m.start + m.length;
  staveList.forEach((stave, s) => {
    const startClef = m.clefs[s] ?? (s === 0 ? 'treble' : 'bass');
    const mine = els.filter((e) => e.staff === s + 1);
    const voiceIds = [...new Set(mine.map((e) => e.voice))].sort();
    /** 小节中间换谱号：画在第一个声部里 */
    const changes = (m.clefChanges ?? []).filter(
      (c) => c.staff === s + 1 && c.tick > m.start && c.tick < end,
    );
    voiceIds.forEach((vid, vi) => {
      const pendingClefs = vi === 0 ? [...changes] : [];
      const list = mine.filter((e) => e.voice === vid).sort((a, b) => a.start - b.start);
      const multi = voiceIds.length > 1;
      const tickables: Tickable[] = [];
      const staveNotes: StaveNote[] = [];
      /** 谱上写了符杠连法时按它画 */
      const explicitBeams = list.some((e) => e.beam);
      let beamRun: StaveNote[] | null = null;
      let cursor = m.start;
      let tupletRun: { notes: StaveNote[]; actual: number; normal: number } | null = null;
      const flushTuplet = () => {
        if (tupletRun?.notes.length) {
          tuplets.push(
            new Tuplet(tupletRun.notes, {
              numNotes: tupletRun.actual,
              notesOccupied: tupletRun.normal,
              ratioed: false,
            }),
          );
        }
        tupletRun = null;
      };
      for (const e of list) {
        const clef = e.clef ?? startClef;
        while (pendingClefs[0] && pendingClefs[0].tick <= e.start) {
          const c = pendingClefs.shift() as (typeof pendingClefs)[number];
          tickables.push(new ClefNote(c.clef, 'small'));
        }
        if (e.start > cursor) {
          flushTuplet();
          for (const p of splitTicks(e.start - cursor)) {
            tickables.push(new GhostNote(`${CODE[p.type]}${'d'.repeat(p.dots)}`));
          }
        }
        cursor = Math.max(cursor, e.start + e.dur);
        const duration = `${CODE[e.type]}${'d'.repeat(e.dots)}${e.rest ? 'r' : ''}`;
        const stemDirection = e.stem
          ? e.stem === 'up'
            ? Stem.UP
            : Stem.DOWN
          : multi
            ? vi === 0
              ? Stem.UP
              : Stem.DOWN
            : null;
        const note = new StaveNote({
          keys: e.rest
            ? [e.restAt ? vexKey(e.restAt) : (REST_KEY[clef] ?? 'b/4')]
            : e.pitches.map((p) => vexKey(p.spelled, e.octaveShift ?? 0)),
          duration,
          clef,
          ...(stemDirection !== null ? { stemDirection } : { autoStem: true }),
          ...(e.rest && e.dur >= m.length && e.type === 'whole' ? { alignCenter: true } : {}),
        });
        e.pitches.forEach((p, i) => {
          if (p.accidental) note.addModifier(new Accidental(p.accidental), i);
        });
        if (e.dots) Dot.buildAndAttach([note], { all: true });
        if (e.graces?.length) {
          const graceNotes = e.graces.map((g) => {
            const gn = new GraceNote({
              keys: g.spelled.map((k) => vexKey(k, e.octaveShift ?? 0)),
              duration: CODE[g.type === 'whole' || g.type === 'half' ? 'eighth' : g.type],
              clef,
              slash: g.slash,
            });
            g.accidentals.forEach((a, i) => {
              if (a) gn.addModifier(new Accidental(a), i);
            });
            return gn;
          });
          const group = new GraceNoteGroup(graceNotes, graceNotes.length > 1);
          if (graceNotes.length > 1) group.beamNotes();
          note.addModifier(group, 0);
        }
        if (e.arpeggio && !e.rest)
          arpeggios.push({ note, acc: e.pitches.some((p) => p.accidental) });
        const up = note.getStemDirection() === Stem.UP;
        for (const a of e.articulations ?? []) {
          if (a === 'fermata') {
            note.addModifier(new Articulation('a@a').setPosition(Modifier.Position.ABOVE), 0);
            continue;
          }
          const code = ARTICULATION_CODE[a];
          if (!code) continue;
          note.addModifier(
            new Articulation(code).setPosition(
              up ? Modifier.Position.BELOW : Modifier.Position.ABOVE,
            ),
            0,
          );
        }
        if (e.tuplet) {
          const t = e.tuplet;
          let run = tupletRun as { notes: StaveNote[]; actual: number; normal: number } | null;
          if (!run || run.actual !== t.actual || run.normal !== t.normal) {
            flushTuplet();
            run = { notes: [], actual: t.actual, normal: t.normal };
            tupletRun = run;
          }
          run.notes.push(note);
          if (run.notes.length >= t.actual) flushTuplet();
        } else flushTuplet();
        tickables.push(note);
        if (!e.rest) staveNotes.push(note);
        if (!e.rest) register(e, note);
        if (explicitBeams) {
          if (e.beam === 'begin') beamRun = [note];
          else if (e.beam === 'continue' && beamRun) beamRun.push(note);
          else if (e.beam === 'end' && beamRun) {
            beamRun.push(note);
            if (beamRun.length > 1) {
              try {
                // 谱上写了符干方向就照着画，否则让符杠自己决定
                beams.push(new Beam(beamRun, !list.some((x) => x.stem)));
              } catch {
                // 符杠画不出来（例如时值不对）时不画
              }
            }
            beamRun = null;
          }
        }
      }
      flushTuplet();
      for (const c of pendingClefs) tickables.push(new ClefNote(c.clef, 'small'));
      if (tickables.length === 0) return;
      const voice = new Voice({ numBeats: m.beats, beatValue: m.beatType }).setMode(
        Voice.Mode.SOFT,
      );
      voice.addTickables(tickables);
      if (!explicitBeams) {
        beams.push(...Beam.generateBeams(staveNotes, { groups, maintainStemDirections: multi }));
      }
      voices.push({ voice, stave });
    });
  });

  const startX = Math.max(...staveList.map((s) => s.getNoteStartX()));
  if (voices.length === 0) return startX;
  for (const s of staveList) s.setNoteStartX(startX);
  const formatter = new Formatter();
  for (const stave of staveList) {
    const vs = voices.filter((v) => v.stave === stave).map((v) => v.voice);
    if (vs.length) formatter.joinVoices(vs);
  }
  const justify = Math.max(20, (staveList[0] as Stave).getNoteEndX() - startX - 8);
  try {
    formatter.format(
      voices.map((v) => v.voice),
      justify,
    );
  } catch {
    // 格式化失败（极少见的复杂节奏）时退回到每个谱表单独排
    for (const v of voices) new Formatter().joinVoices([v.voice]).format([v.voice], justify);
  }
  for (const v of voices) v.voice.draw(ctx, v.stave);
  for (const b of beams) b.setContext(ctx).draw();
  for (const t of tuplets) t.setContext(ctx).draw();
  for (const a of arpeggios) drawArpeggio(ctx, a.note, a.acc);
  return startX;
}

/** 琶音：和弦左边一条竖的波浪线 */
function drawArpeggio(ctx: Ctx, note: StaveNote, acc: boolean) {
  const ys = note.getYs();
  const top = Math.min(...ys) - 6;
  const bottom = Math.max(...ys) + 6;
  const x = note.getNoteHeadBeginX() - (acc ? 18 : 8);
  ctx.save();
  ctx.setLineWidth(1.2);
  ctx.beginPath();
  ctx.moveTo(x, top);
  for (let y = top, i = 0; y < bottom; y += 4, i++) ctx.lineTo(x + (i % 2 ? -2 : 2), y + 4);
  ctx.stroke();
  ctx.restore();
}

function drawTies(score: Score, noteOf: Map<NotationElement, Placed>, ctx: Ctx) {
  const byStart = new Map<string, NotationElement[]>();
  for (const e of score.elements) {
    const key = `${e.staff}:${e.start}`;
    const list = byStart.get(key);
    if (list) list.push(e);
    else byStart.set(key, [e]);
  }
  for (const [e, a] of noteOf) {
    e.pitches.forEach((p, i) => {
      if (!p.tieStart) return;
      const next = byStart
        .get(`${e.staff}:${e.start + e.dur}`)
        ?.find((n) => n.pitches.some((q) => q.pitch === p.pitch && q.tieStop));
      const b = next ? noteOf.get(next) : undefined;
      if (!next || !b) return;
      const j = next.pitches.findIndex((q) => q.pitch === p.pitch);
      try {
        if (a.line === b.line) {
          new StaveTie({ firstNote: a.note, lastNote: b.note, firstIndexes: [i], lastIndexes: [j] })
            .setContext(ctx)
            .draw();
        } else {
          new StaveTie({ firstNote: a.note, lastNote: null, firstIndexes: [i], lastIndexes: [i] })
            .setContext(ctx)
            .draw();
          new StaveTie({ firstNote: null, lastNote: b.note, firstIndexes: [j], lastIndexes: [j] })
            .setContext(ctx)
            .draw();
        }
      } catch {
        // 连音线画不出来不影响其他内容
      }
    });
  }
}

/** 连线（圆滑线）：按谱表和编号配对 start / stop；跨行时分两段画 */
function drawSlurs(score: Score, noteOf: Map<NotationElement, Placed>, ctx: Ctx) {
  const open = new Map<string, { e: NotationElement; placement?: 'above' | 'below' }>();
  const ordered = [...score.elements].sort((a, b) => a.start - b.start);
  for (const e of ordered) {
    for (const s of e.slurs ?? []) {
      const key = `${e.staff}:${s.number}`;
      if (s.type === 'start') {
        open.set(key, { e, ...(s.placement ? { placement: s.placement } : {}) });
        continue;
      }
      const from = open.get(key);
      open.delete(key);
      if (!from) continue;
      const a = noteOf.get(from.e);
      const b = noteOf.get(e);
      if (!a || !b) continue;
      const up = a.note.getStemDirection() === Stem.UP;
      // 连线默认画在符头一侧（与符干相反）；谱上指定了位置且与之相反时翻过来
      const invert = from.placement !== undefined && (from.placement === 'above') === up;
      const opts = {
        invert,
        cps: [
          { x: 0, y: 12 },
          { x: 0, y: 12 },
        ],
      };
      try {
        if (a.line === b.line) {
          new Curve(a.note, b.note, opts).setContext(ctx).draw();
        } else {
          new Curve(a.note, undefined, opts).setContext(ctx).draw();
          new Curve(undefined, b.note, opts).setContext(ctx).draw();
        }
      } catch {
        // 连线画不出来不影响其他内容
      }
    }
  }
}
