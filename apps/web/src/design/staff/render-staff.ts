import { majorScale, nameToMidi, parseNoteName, type RhythmToken } from '@mayochord/core';
import {
  Accidental,
  Annotation,
  Beam,
  Dot,
  Formatter,
  GhostNote,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  StaveTie,
  Tuplet,
  Voice,
} from 'vexflow/bravura';

const ACC: Record<number, string> = { [-2]: 'bb', [-1]: 'b', 1: '#', 2: '##' };

/** 'Bb4' → { key: 'bb/4', accidental: 'b' } */
function toVexKey(name: string): { key: string; accidental: string | null } {
  const n = parseNoteName(name);
  if (!n || n.octave === undefined) throw new Error(`Invalid note: ${name}`);
  const acc = ACC[n.alter] ?? '';
  return { key: `${n.letter.toLowerCase()}${acc}/${n.octave}`, accidental: acc || null };
}

function chordNote(names: readonly string[], clef: 'treble' | 'bass'): StaveNote {
  if (names.length === 0) {
    return new StaveNote({ keys: [clef === 'treble' ? 'b/4' : 'd/3'], duration: 'wr', clef });
  }
  const keys = names.map(toVexKey);
  const note = new StaveNote({ keys: keys.map((k) => k.key), duration: 'w', clef });
  keys.forEach((k, i) => {
    if (k.accidental) note.addModifier(new Accidental(k.accidental), i);
  });
  return note;
}

export interface GrandStaffNotes {
  /** 左手（低音谱表）音名，例如 ['A3'] */
  lh: readonly string[];
  /** 右手（高音谱表）音名，例如 ['G4', 'C5', 'E5'] */
  rh: readonly string[];
}

const WIDTH = 210;
const HEIGHT = 222;

/**
 * 在 el 里画一个大谱表（高音 + 低音谱表），左右手各一个全音符和弦。
 * 颜色用 currentColor，跟随主题；SVG 按容器宽度缩放。
 */
export function renderGrandStaff(el: HTMLElement, { lh, rh }: GrandStaffNotes) {
  el.replaceChildren();
  const renderer = new Renderer(el as HTMLDivElement, Renderer.Backends.SVG);
  renderer.resize(WIDTH, HEIGHT);
  const ctx = renderer.getContext();
  ctx.setFillStyle('currentColor');
  ctx.setStrokeStyle('currentColor');

  const x = 22;
  const w = WIDTH - x - 6;
  const treble = new Stave(x, 20, w).addClef('treble');
  const bass = new Stave(x, 130, w).addClef('bass');
  treble.setContext(ctx).draw();
  bass.setContext(ctx).draw();
  for (const type of ['brace', 'singleLeft', 'singleRight'] as const) {
    new StaveConnector(treble, bass).setType(type).setContext(ctx).draw();
  }

  for (const [stave, names, clef] of [
    [treble, rh, 'treble'],
    [bass, lh, 'bass'],
  ] as const) {
    const voice = new Voice({ numBeats: 4, beatValue: 4 });
    voice.addTickables([chordNote(names, clef)]);
    new Formatter().joinVoices([voice]).format([voice], w - 70);
    voice.draw(ctx, stave);
  }

  const svg = el.querySelector('svg');
  if (svg) {
    svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('aria-hidden', 'true');
  }
}

/** 等 Bravura 字体加载完再排版（否则量出来的符头宽度不对） */
export async function staffFontsReady(): Promise<void> {
  try {
    await document.fonts.load('30pt Bravura');
  } catch {
    // 加载失败也照样画
  }
}

function finishSvg(el: HTMLElement, width: number, height: number) {
  const svg = el.querySelector('svg');
  if (svg) {
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.removeAttribute('style');
    svg.setAttribute('aria-hidden', 'true');
  }
}

/** 调号里每个字母的升降（'D' → { F: 1, C: 1 }） */
function keyAlters(key: string | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!key) return out;
  for (const name of majorScale(key)) {
    const n = parseNoteName(name);
    if (n && n.alter !== 0) out.set(n.letter, n.alter);
  }
  return out;
}

const ACC_OR_NATURAL: Record<number, string> = { ...ACC, 0: 'n' };

/** 音符在调号下要画的记号：与调号一致的不画；调号升降过的字母写成本位时画还原号 */
function accidentalInKey(name: string, alters: Map<string, number>): string | null {
  const n = parseNoteName(name);
  if (!n) return null;
  const inKey = alters.get(n.letter) ?? 0;
  if (n.alter === inKey) return null;
  return ACC_OR_NATURAL[n.alter] ?? null;
}

function prettyLabel(name: string): string {
  const n = parseNoteName(name);
  if (!n) return name;
  const acc = n.alter > 0 ? '♯'.repeat(n.alter) : '♭'.repeat(-n.alter);
  return `${n.letter}${acc}${n.octave ?? ''}`;
}

export interface StaffLineOptions {
  clef: 'treble' | 'bass' | 'grand';
  /** 调号（大调主音），null = 没有 */
  key: string | null;
  /** 依次画出的音（全音符）；grand 时 C4 及以上画在高音谱表，以下画在低音谱表 */
  notes: readonly string[];
  /** 每个音下面标音名 */
  labels: boolean;
}

/**
 * 一行谱表（或大谱表）上依次画几个全音符，带谱号、调号，可以在音下面标音名
 * （读谱课程的示范、看谱认音题）。返回 SVG 的宽高比。
 */
export function renderStaffLine(
  el: HTMLElement,
  opts: StaffLineOptions,
): { aspect: number; width: number } {
  el.replaceChildren();
  const alters = keyAlters(opts.key);
  const slots = Math.max(1, opts.notes.length);
  const grand = opts.clef === 'grand';
  const width = Math.max(150, (grand ? 84 : 70) + alters.size * 10 + slots * 46);
  const height = grand ? 260 : 150;
  const renderer = new Renderer(el as HTMLDivElement, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const ctx = renderer.getContext();
  ctx.setFillStyle('currentColor');
  ctx.setStrokeStyle('currentColor');

  const x = grand ? 22 : 8;
  const w = width - x - 6;
  const staves: { stave: Stave; clef: 'treble' | 'bass' }[] = grand
    ? [
        { stave: new Stave(x, 20, w), clef: 'treble' },
        { stave: new Stave(x, 145, w), clef: 'bass' },
      ]
    : [{ stave: new Stave(x, 25, w), clef: opts.clef === 'bass' ? 'bass' : 'treble' }];
  for (const { stave, clef } of staves) {
    stave.addClef(clef);
    if (opts.key && alters.size > 0) stave.addKeySignature(opts.key);
    stave.setContext(ctx).draw();
  }
  const [top, bottom] = staves;
  if (grand && top && bottom) {
    for (const type of ['brace', 'singleLeft', 'singleRight'] as const) {
      new StaveConnector(top.stave, bottom.stave).setType(type).setContext(ctx).draw();
    }
  }

  const middleC = 60;
  for (const { stave, clef } of staves) {
    if (opts.notes.length === 0) continue;
    const tickables = opts.notes.map((name) => {
      const midi = nameToMidi(name) ?? middleC;
      const mine = !grand || (clef === 'treble' ? midi >= middleC : midi < middleC);
      if (!mine) {
        // 另一行的音：这里放一个看不见的占位，两行的音上下对齐
        return new GhostNote('w');
      }
      const note = new StaveNote({ keys: [toVexKey(name).key], duration: 'w', clef });
      const acc = accidentalInKey(name, alters);
      if (acc) note.addModifier(new Accidental(acc), 0);
      if (opts.labels) {
        note.addModifier(
          new Annotation(prettyLabel(name)).setVerticalJustification(
            Annotation.VerticalJustify.BOTTOM,
          ),
          0,
        );
      }
      return note;
    });
    const voice = new Voice({ numBeats: 4 * tickables.length, beatValue: 4 });
    voice.addTickables(tickables);
    new Formatter()
      .joinVoices([voice])
      .format([voice], stave.getNoteEndX() - stave.getNoteStartX() - 10);
    voice.draw(ctx, stave);
  }
  finishSvg(el, width, height);
  return { aspect: width / height, width };
}

const CODE: Record<RhythmToken['base'], string> = { w: 'w', h: 'h', q: 'q', '8': '8', '16': '16' };

/**
 * 一小节节奏（节奏读谱）：打击乐谱号的五线谱，音符都在第三线；符杠按拍号分组，
 * 三连音、连音线、附点、休止符。返回宽高比和每个"要按的起点"对应的 SVG 元素（按顺序，用来着色）。
 */
export function renderRhythm(
  el: HTMLElement,
  tokens: readonly RhythmToken[],
  time: readonly [number, number],
): { aspect: number; width: number; onsetEls: SVGElement[] } {
  el.replaceChildren();
  const width = Math.max(280, 100 + tokens.length * 36);
  const height = 120;
  const renderer = new Renderer(el as HTMLDivElement, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const ctx = renderer.getContext();
  ctx.setFillStyle('currentColor');
  ctx.setStrokeStyle('currentColor');
  const stave = new Stave(6, 15, width - 12);
  stave.addClef('percussion').addTimeSignature(`${time[0]}/${time[1]}`);
  stave.setContext(ctx).draw();

  const notes: StaveNote[] = [];
  const tuplets: Tuplet[] = [];
  const onsets: StaveNote[] = [];
  let run: StaveNote[] = [];
  tokens.forEach((tok, i) => {
    const duration = `${CODE[tok.base]}${'d'.repeat(tok.dots)}${tok.rest ? 'r' : ''}`;
    // 位置按高音谱号算（第三线），谱号画成打击乐谱号；符干一律向上
    const note = new StaveNote({ keys: ['b/4'], duration, clef: 'treble', stemDirection: 1 });
    if (tok.dots) Dot.buildAndAttach([note], { all: true });
    notes.push(note);
    const prev = tokens[i - 1];
    if (!tok.rest && !(prev?.tie && !prev.rest)) onsets.push(note);
    if (tok.triplet) {
      run.push(note);
      if (run.length === 3) {
        tuplets.push(new Tuplet(run, { numNotes: 3, notesOccupied: 2, ratioed: false }));
        run = [];
      }
    }
  });
  const voice = new Voice({ numBeats: time[0], beatValue: time[1] }).setMode(Voice.Mode.SOFT);
  voice.addTickables(notes);
  const beams = Beam.generateBeams(
    notes.filter((_, i) => !tokens[i]?.rest),
    { groups: Beam.getDefaultBeamGroups(`${time[0]}/${time[1]}`), stemDirection: 1 },
  );
  new Formatter()
    .joinVoices([voice])
    .format([voice], stave.getNoteEndX() - stave.getNoteStartX() - 10);
  voice.draw(ctx, stave);
  for (const b of beams) b.setContext(ctx).draw();
  for (const t of tuplets) t.setContext(ctx).draw();
  tokens.forEach((tok, i) => {
    const cur = notes[i];
    const next = notes[i + 1];
    if (tok.tie && !tok.rest && cur && next) {
      new StaveTie({ firstNote: cur, lastNote: next, firstIndexes: [0], lastIndexes: [0] })
        .setContext(ctx)
        .draw();
    }
  });
  finishSvg(el, width, height);
  return {
    aspect: width / height,
    width,
    onsetEls: onsets.map((n) => n.getSVGElement()).filter((x): x is SVGElement => x !== undefined),
  };
}
