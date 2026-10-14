import { type PitchClass, pitchClassName, type Spelling } from './notes';

/** 支持的和弦性质。ID 使用 ASCII，显示时再转换成 ♭ ♯ 和较小的扩展部分。 */
export type ChordQuality =
  | 'maj'
  | 'm'
  | 'dim'
  | 'aug'
  | 'sus2'
  | 'sus4'
  | '6'
  | 'm6'
  | 'M7'
  | '7'
  | 'm7'
  | 'm7b5'
  | 'dim7'
  | 'mM7'
  | 'add9'
  | 'madd9'
  | '7(9)'
  | 'M7(9)'
  | 'm7(9)';

export interface ChordQualityDef {
  quality: ChordQuality;
  /** 相对根音的半音数 */
  intervals: readonly number[];
  /** 允许省略五音（键盘上七和弦、九和弦常省略五音） */
  omit5Allowed: boolean;
  /** 常见程度，用于多解排序（越大越常见） */
  commonness: number;
  /** 排版：主体与较小的扩展部分，例如 m7♭5 → main 'm7'，ext '♭5' */
  display: { main: string; ext: string };
}

function q(
  quality: ChordQuality,
  intervals: number[],
  commonness: number,
  main: string,
  ext = '',
  omit5Allowed = false,
): ChordQualityDef {
  return { quality, intervals, omit5Allowed, commonness, display: { main, ext } };
}

export const CHORD_QUALITIES: readonly ChordQualityDef[] = [
  q('maj', [0, 4, 7], 10, ''),
  q('m', [0, 3, 7], 10, 'm'),
  q('7', [0, 4, 7, 10], 9, '7', '', true),
  q('m7', [0, 3, 7, 10], 9, 'm7', '', true),
  q('M7', [0, 4, 7, 11], 8, 'M7', '', true),
  q('sus4', [0, 5, 7], 7, 'sus4'),
  q('add9', [0, 2, 4, 7], 7, '', 'add9'),
  q('7(9)', [0, 2, 4, 7, 10], 7, '7', '(9)', true),
  q('m7b5', [0, 3, 6, 10], 6, 'm7', '♭5'),
  q('dim', [0, 3, 6], 6, 'dim'),
  q('sus2', [0, 2, 7], 6, 'sus2'),
  q('6', [0, 4, 7, 9], 6, '6'),
  q('madd9', [0, 2, 3, 7], 6, 'm', 'add9'),
  q('M7(9)', [0, 2, 4, 7, 11], 6, 'M7', '(9)', true),
  q('m7(9)', [0, 2, 3, 7, 10], 6, 'm7', '(9)', true),
  q('aug', [0, 4, 8], 5, 'aug'),
  q('dim7', [0, 3, 6, 9], 5, 'dim7'),
  q('m6', [0, 3, 7, 9], 5, 'm6'),
  q('mM7', [0, 3, 7, 11], 4, 'mM7', '', true),
];

const BY_QUALITY = new Map(CHORD_QUALITIES.map((d) => [d.quality, d]));

export function chordQualityDef(quality: ChordQuality): ChordQualityDef {
  const def = BY_QUALITY.get(quality);
  if (!def) throw new Error(`Unknown chord quality: ${quality}`);
  return def;
}

export interface ChordSymbol {
  root: PitchClass;
  quality: ChordQuality;
  /** 斜杠和弦的低音；与根音相同时省略 */
  bass?: PitchClass;
}

export type Accidental = '' | '♭' | '♯';

/** 排版用的分段：根音字母、根音升降号、主体、扩展（较小字号）、斜杠低音。 */
export interface ChordSymbolParts {
  rootLetter: string;
  rootAccidental: Accidental;
  main: string;
  ext: string;
  bass?: { letter: string; accidental: Accidental };
}

function splitName(name: string): { letter: string; accidental: Accidental } {
  const acc = name.charAt(1);
  return { letter: name.charAt(0), accidental: acc === '#' ? '♯' : acc === 'b' ? '♭' : '' };
}

export function chordSymbolParts(sym: ChordSymbol, spelling?: Spelling): ChordSymbolParts {
  const root = splitName(pitchClassName(sym.root, spelling));
  const { display } = chordQualityDef(sym.quality);
  const parts: ChordSymbolParts = {
    rootLetter: root.letter,
    rootAccidental: root.accidental,
    main: display.main,
    ext: display.ext,
  };
  if (sym.bass !== undefined && sym.bass !== sym.root) {
    parts.bass = splitName(pitchClassName(sym.bass, spelling));
  }
  return parts;
}

/** 单行文本形式，如 'Cm7♭5'、'C7(9)'、'F♯m/E'。 */
export function formatChordSymbol(sym: ChordSymbol, spelling?: Spelling): string {
  const p = chordSymbolParts(sym, spelling);
  const bass = p.bass ? `/${p.bass.letter}${p.bass.accidental}` : '';
  return `${p.rootLetter}${p.rootAccidental}${p.main}${p.ext}${bass}`;
}
