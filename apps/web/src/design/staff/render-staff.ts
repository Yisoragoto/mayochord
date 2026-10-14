import { parseNoteName } from '@mayochord/core';
import {
  Accidental,
  Formatter,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
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
