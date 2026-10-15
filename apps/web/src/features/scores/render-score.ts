import {
  type DurationType,
  type NotationElement,
  type Score,
  type ScoreMeasure,
  splitTicks,
} from '@mayochord/core';
import {
  Accidental,
  BarlineType,
  Beam,
  Dot,
  Formatter,
  GhostNote,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  StaveTie,
  Stem,
  type Tickable,
  Tuplet,
  Voice,
} from 'vexflow/bravura';

/**
 * 用 VexFlow 把整首曲子排成若干行（每行若干小节），画成一个 SVG。
 * 小节宽度按音符数估计，再拉伸填满一行（最后一行太空时不拉伸）。
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

/** 'Bb4' → 'bb/4'（VexFlow 只用字母和八度定位，临时记号另外加） */
function vexKey(spelled: string): string {
  const m = /^([A-G])([#b]*)(-?\d+)$/.exec(spelled);
  if (!m) return 'c/4';
  return `${(m[1] as string).toLowerCase()}${m[2]}/${m[3]}`;
}

const STAFF_GAP = 90;
const SYSTEM_GAP = 36;
const TOP = 16;

export interface MeasureBox {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScoreLayout {
  width: number;
  height: number;
  /** 每个小节的位置（叠加高亮、点击用） */
  measures: MeasureBox[];
  /** 演奏音 id → 画出来的音符（SVG 组） */
  noteEls: Map<number, Element[]>;
}

function measureMinWidth(score: Score, els: NotationElement[]): number {
  let widest = 0;
  for (let s = 1; s <= score.staves; s++) {
    const mine = els.filter((e) => e.staff === s);
    const acc = mine.reduce((n, e) => n + e.pitches.filter((p) => p.accidental).length, 0);
    const dots = mine.reduce((n, e) => n + e.dots, 0);
    // 不同声部同时开始的音只占一个位置
    const slots = new Set(mine.map((e) => e.start)).size;
    widest = Math.max(widest, slots * 26 + acc * 9 + dots * 5);
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

export function renderScore(el: HTMLElement, score: Score, width: number): ScoreLayout {
  el.replaceChildren();
  const renderer = new Renderer(el as HTMLDivElement, Renderer.Backends.SVG);
  const ctx = renderer.getContext();
  ctx.setFillStyle('currentColor');
  ctx.setStrokeStyle('currentColor');

  const staves = score.staves;
  const x0 = staves > 1 ? 28 : 10;
  const available = Math.max(200, width - x0 - 10);
  const systemHeight = (staves - 1) * STAFF_GAP + 100;

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

  // 分行
  type Line = { measures: number[]; widths: number[] };
  const lines: Line[] = [];
  let line: Line = { measures: [], widths: [] };
  let used = 0;
  score.measures.forEach((m, i) => {
    const body = measureMinWidth(score, byMeasure.get(i) ?? []);
    const first = line.measures.length === 0;
    const w = body + (first ? headerWidth(m, timeChanged(i)) : timeChanged(i) ? 30 : 0);
    if (!first && used + w > available) {
      lines.push(line);
      line = { measures: [], widths: [] };
      used = 0;
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

  const height = TOP + lines.length * (systemHeight + SYSTEM_GAP);
  renderer.resize(width, height);

  const boxes: MeasureBox[] = [];
  const noteOf = new Map<NotationElement, { note: StaveNote; line: number }>();
  const lastIndex = score.measures.length - 1;

  lines.forEach((ln, li) => {
    const total = ln.widths.reduce((a, b) => a + b, 0);
    const isLast = li === lines.length - 1;
    const stretch = isLast && total < available * 0.6 ? 1 : available / total;
    const y = TOP + li * (systemHeight + SYSTEM_GAP);
    let x = x0;
    ln.measures.forEach((mi, pos) => {
      const m = score.measures[mi] as ScoreMeasure;
      const w = (ln.widths[pos] as number) * stretch;
      const prev = score.measures[mi - 1];
      const staveList: Stave[] = [];
      for (let s = 0; s < staves; s++) {
        const stave = new Stave(x, y + s * STAFF_GAP, w);
        if (pos === 0) {
          stave.addClef(m.clefs[s] ?? (s === 0 ? 'treble' : 'bass'));
          stave.addKeySignature(keyName(m.fifths));
        } else if (prev && prev.fifths !== m.fifths) {
          stave.addKeySignature(keyName(m.fifths), keyName(prev.fifths));
        }
        if (timeChanged(mi)) stave.addTimeSignature(`${m.beats}/${m.beatType}`);
        if (mi === lastIndex) stave.setEndBarType(BarlineType.END);
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
        new StaveConnector(top, bottom)
          .setType(mi === lastIndex ? 'boldDoubleRight' : 'singleRight')
          .setContext(ctx)
          .draw();
      }
      boxes.push({
        index: mi,
        x,
        y: top.getYForLine(0) - 14,
        w,
        h: bottom.getYForLine(4) - top.getYForLine(0) + 28,
      });

      drawMeasure(m, byMeasure.get(mi) ?? [], staveList, ctx, (e, note) =>
        noteOf.set(e, { note, line: li }),
      );
      x += w;
    });
  });

  drawTies(score, noteOf, ctx);

  const noteEls = new Map<number, Element[]>();
  for (const [e, { note }] of noteOf) {
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
  return { width, height, measures: boxes, noteEls };
}

function drawMeasure(
  m: ScoreMeasure,
  els: NotationElement[],
  staveList: Stave[],
  ctx: ReturnType<Renderer['getContext']>,
  register: (e: NotationElement, note: StaveNote) => void,
) {
  const voices: { voice: Voice; stave: Stave }[] = [];
  const beams: Beam[] = [];
  const tuplets: Tuplet[] = [];
  const groups = Beam.getDefaultBeamGroups(`${m.beats}/${m.beatType}`);

  staveList.forEach((stave, s) => {
    const clef = m.clefs[s] ?? (s === 0 ? 'treble' : 'bass');
    const mine = els.filter((e) => e.staff === s + 1);
    const voiceIds = [...new Set(mine.map((e) => e.voice))].sort();
    voiceIds.forEach((vid, vi) => {
      const list = mine.filter((e) => e.voice === vid).sort((a, b) => a.start - b.start);
      const multi = voiceIds.length > 1;
      const stemDirection = vi === 0 ? Stem.UP : Stem.DOWN;
      const tickables: Tickable[] = [];
      const staveNotes: StaveNote[] = [];
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
        if (e.start > cursor) {
          flushTuplet();
          for (const p of splitTicks(e.start - cursor)) {
            tickables.push(new GhostNote(`${CODE[p.type]}${'d'.repeat(p.dots)}`));
          }
        }
        cursor = Math.max(cursor, e.start + e.dur);
        const duration = `${CODE[e.type]}${'d'.repeat(e.dots)}${e.rest ? 'r' : ''}`;
        const note = new StaveNote({
          keys: e.rest ? [REST_KEY[clef] ?? 'b/4'] : e.pitches.map((p) => vexKey(p.spelled)),
          duration,
          clef,
          ...(multi ? { stemDirection } : { autoStem: true }),
          ...(e.rest && e.dur >= m.length && e.type === 'whole' ? { alignCenter: true } : {}),
        });
        e.pitches.forEach((p, i) => {
          if (p.accidental) note.addModifier(new Accidental(p.accidental), i);
        });
        if (e.dots) Dot.buildAndAttach([note], { all: true });
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
      }
      flushTuplet();
      if (tickables.length === 0) return;
      const voice = new Voice({ numBeats: m.beats, beatValue: m.beatType }).setMode(
        Voice.Mode.SOFT,
      );
      voice.addTickables(tickables);
      beams.push(...Beam.generateBeams(staveNotes, { groups, maintainStemDirections: multi }));
      voices.push({ voice, stave });
    });
  });

  if (voices.length === 0) return;
  const startX = Math.max(...staveList.map((s) => s.getNoteStartX()));
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
}

function drawTies(
  score: Score,
  noteOf: Map<NotationElement, { note: StaveNote; line: number }>,
  ctx: ReturnType<Renderer['getContext']>,
) {
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
