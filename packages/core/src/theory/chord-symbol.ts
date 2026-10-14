import {
  nameToPitchClass,
  type PitchClass,
  parseNoteName,
  pitchClassName,
  type Spelling,
  spellInterval,
} from './notes';

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

/** 和弦里的一个音：度数（1、3、5、7、9…）与距根音的半音数（九度为 14）。 */
export interface ChordTone {
  degree: number;
  semitones: number;
}

export interface ChordQualityDef {
  quality: ChordQuality;
  /** 按叠置顺序（度数从低到高）排列的组成音 */
  tones: readonly ChordTone[];
  /** 相对根音的半音数（模 12），用于音级集合比较 */
  intervals: readonly number[];
  /** 允许省略五音（键盘上七和弦、九和弦常省略五音） */
  omit5Allowed: boolean;
  /** 小调色彩（小三度为三音）：用于级数的大小写 */
  minorThird: boolean;
  /** 常见程度，用于多解排序（越大越常见） */
  commonness: number;
  /** 排版：主体与较小的扩展部分，例如 m7♭5 → main 'm7'，ext '♭5' */
  display: { main: string; ext: string };
  /** URL 安全的 ID 后缀，例如 M7 → 'maj7'，7(9) → '7-9' */
  slug: string;
}

function q(
  quality: ChordQuality,
  tones: [number, number][],
  commonness: number,
  display: [string, string],
  slug: string,
  omit5Allowed = false,
): ChordQualityDef {
  const t = tones.map(([degree, semitones]) => ({ degree, semitones }));
  return {
    quality,
    tones: t,
    intervals: t.map((x) => x.semitones % 12),
    omit5Allowed,
    minorThird: t.some((x) => x.degree === 3 && x.semitones === 3),
    commonness,
    display: { main: display[0], ext: display[1] },
    slug,
  };
}

const R: [number, number] = [1, 0];
const M3: [number, number] = [3, 4];
const m3: [number, number] = [3, 3];
const P5: [number, number] = [5, 7];
const d5: [number, number] = [5, 6];
const A5: [number, number] = [5, 8];
const m7: [number, number] = [7, 10];
const M7: [number, number] = [7, 11];
const d7: [number, number] = [7, 9];
const M9: [number, number] = [9, 14];

export const CHORD_QUALITIES: readonly ChordQualityDef[] = [
  q('maj', [R, M3, P5], 10, ['', ''], ''),
  q('m', [R, m3, P5], 10, ['m', ''], 'm'),
  q('7', [R, M3, P5, m7], 9, ['7', ''], '7', true),
  q('m7', [R, m3, P5, m7], 9, ['m7', ''], 'm7', true),
  q('M7', [R, M3, P5, M7], 8, ['M7', ''], 'maj7', true),
  q('sus4', [R, [4, 5], P5], 7, ['sus4', ''], 'sus4'),
  q('add9', [R, M3, P5, M9], 7, ['', 'add9'], 'add9'),
  q('7(9)', [R, M3, P5, m7, M9], 7, ['7', '(9)'], '7-9', true),
  q('m7b5', [R, m3, d5, m7], 6, ['m7', '♭5'], 'm7b5'),
  q('dim', [R, m3, d5], 6, ['dim', ''], 'dim'),
  q('sus2', [R, [2, 2], P5], 6, ['sus2', ''], 'sus2'),
  q('6', [R, M3, P5, [6, 9]], 6, ['6', ''], '6'),
  q('madd9', [R, m3, P5, M9], 6, ['m', 'add9'], 'madd9'),
  q('M7(9)', [R, M3, P5, M7, M9], 6, ['M7', '(9)'], 'maj7-9', true),
  q('m7(9)', [R, m3, P5, m7, M9], 6, ['m7', '(9)'], 'm7-9', true),
  q('aug', [R, M3, A5], 5, ['aug', ''], 'aug'),
  q('dim7', [R, m3, d5, d7], 5, ['dim7', ''], 'dim7'),
  q('m6', [R, m3, P5, [6, 9]], 5, ['m6', ''], 'm6'),
  q('mM7', [R, m3, P5, M7], 4, ['mM7', ''], 'mmaj7', true),
];

const BY_QUALITY = new Map(CHORD_QUALITIES.map((d) => [d.quality, d]));

export function chordQualityDef(quality: ChordQuality): ChordQualityDef {
  const def = BY_QUALITY.get(quality);
  if (!def) throw new Error(`Unknown chord quality: ${quality}`);
  return def;
}

export function isChordQuality(s: string): s is ChordQuality {
  return BY_QUALITY.has(s as ChordQuality);
}

export interface ChordSymbol {
  root: PitchClass;
  quality: ChordQuality;
  /** 斜杠和弦的低音；与根音相同时省略 */
  bass?: PitchClass;
  /** 根音的拼写（'Bb'、'A#'）。省略时按默认写法 */
  rootName?: string;
  /** 低音的拼写 */
  bassName?: string;
}

/** 由拼写过的根音名构造 ChordSymbol，例如 symbolFromNames('Bb', 'M7')。 */
export function symbolFromNames(
  rootName: string,
  quality: ChordQuality,
  bassName?: string,
): ChordSymbol {
  const root = nameToPitchClass(rootName);
  if (root === null) throw new Error(`Invalid root name: ${rootName}`);
  const sym: ChordSymbol = { root, quality, rootName };
  if (bassName !== undefined) {
    const bass = nameToPitchClass(bassName);
    if (bass === null) throw new Error(`Invalid bass name: ${bassName}`);
    if (bass !== root) {
      sym.bass = bass;
      sym.bassName = bassName;
    }
  }
  return sym;
}

export type Accidental = '' | '♭' | '♯' | '♭♭' | '♯♯';

/** 排版用的分段：根音字母、根音升降号、主体、扩展（较小字号）、斜杠低音。 */
export interface ChordSymbolParts {
  rootLetter: string;
  rootAccidental: Accidental;
  main: string;
  ext: string;
  bass?: { letter: string; accidental: Accidental };
}

function splitName(name: string): { letter: string; accidental: Accidental } {
  const n = parseNoteName(name);
  if (!n) throw new Error(`Invalid note name: ${name}`);
  const accidental = (
    n.alter > 0 ? '♯'.repeat(n.alter) : n.alter < 0 ? '♭'.repeat(-n.alter) : ''
  ) as Accidental;
  return { letter: n.letter, accidental };
}

export function chordSymbolParts(sym: ChordSymbol, spelling?: Spelling): ChordSymbolParts {
  const root = splitName(sym.rootName ?? pitchClassName(sym.root, spelling));
  const { display } = chordQualityDef(sym.quality);
  const parts: ChordSymbolParts = {
    rootLetter: root.letter,
    rootAccidental: root.accidental,
    main: display.main,
    ext: display.ext,
  };
  if (sym.bass !== undefined && sym.bass !== sym.root) {
    parts.bass = splitName(sym.bassName ?? pitchClassName(sym.bass, spelling));
  }
  return parts;
}

/** 单行文本形式，如 'Cm7♭5'、'C7(9)'、'F♯m/E'。 */
export function formatChordSymbol(sym: ChordSymbol, spelling?: Spelling): string {
  const p = chordSymbolParts(sym, spelling);
  const bass = p.bass ? `/${p.bass.letter}${p.bass.accidental}` : '';
  return `${p.rootLetter}${p.rootAccidental}${p.main}${p.ext}${bass}`;
}

/** 拼写过的组成音（不含八度），按叠置顺序。例：chordTones('G', 'm7') = ['G', 'Bb', 'D', 'F']。 */
export function chordTones(rootName: string, quality: ChordQuality): string[] {
  return chordQualityDef(quality).tones.map((t) => spellInterval(rootName, t.degree, t.semitones));
}

/** 半音距离公式：按叠置顺序相邻两音之间的半音数。例：Am → { tones: [A, C, E], steps: [3, 4] }。 */
export function semitoneFormula(
  rootName: string,
  quality: ChordQuality,
): { tones: string[]; steps: number[] } {
  const { tones } = chordQualityDef(quality);
  const steps = tones.slice(1).map((t, i) => t.semitones - (tones[i] as ChordTone).semitones);
  return { tones: chordTones(rootName, quality), steps };
}

const ROOT_SLUG_ACC: Record<number, string> = { [-2]: 'bb', [-1]: 'b', 0: '', 1: 's', 2: 'ss' };

/**
 * URL 安全的和弦 ID：根音字母小写 + 升降（s / b）+ 性质后缀 + 可选的 -on- 低音。
 * 例：'Gm7' → 'gm7'，'FM7' → 'fmaj7'，'C7(9)' → 'c7-9'，'B♭' → 'bb'，'F♯m7♭5' → 'fsm7b5'，'C/E' → 'c-on-e'。
 */
export function chordSlug(rootName: string, quality: ChordQuality, bassName?: string): string {
  const noteSlug = (name: string) => {
    const n = parseNoteName(name);
    if (!n) throw new Error(`Invalid note name: ${name}`);
    return n.letter.toLowerCase() + (ROOT_SLUG_ACC[n.alter] ?? '');
  };
  const bass = bassName === undefined ? '' : `-on-${noteSlug(bassName)}`;
  return `${noteSlug(rootName)}${chordQualityDef(quality).slug}${bass}`;
}

/** 和弦符号文本里的性质写法 → ChordQuality（包括常见别名）。 */
const QUALITY_ALIASES: Record<string, ChordQuality> = {
  '': 'maj',
  M: 'maj',
  maj: 'maj',
  m: 'm',
  min: 'm',
  '-': 'm',
  dim: 'dim',
  '°': 'dim',
  o: 'dim',
  aug: 'aug',
  '+': 'aug',
  sus2: 'sus2',
  sus4: 'sus4',
  sus: 'sus4',
  '6': '6',
  m6: 'm6',
  M7: 'M7',
  maj7: 'M7',
  Maj7: 'M7',
  Δ: 'M7',
  Δ7: 'M7',
  '7': '7',
  m7: 'm7',
  min7: 'm7',
  '-7': 'm7',
  m7b5: 'm7b5',
  'm7♭5': 'm7b5',
  'm7(b5)': 'm7b5',
  'm7(♭5)': 'm7b5',
  ø: 'm7b5',
  ø7: 'm7b5',
  dim7: 'dim7',
  '°7': 'dim7',
  o7: 'dim7',
  mM7: 'mM7',
  mmaj7: 'mM7',
  'm(maj7)': 'mM7',
  add9: 'add9',
  madd9: 'madd9',
  'm(add9)': 'madd9',
  '7(9)': '7(9)',
  '9': '7(9)',
  'M7(9)': 'M7(9)',
  maj9: 'M7(9)',
  M9: 'M7(9)',
  'm7(9)': 'm7(9)',
  m9: 'm7(9)',
};

const SYMBOL_RE = /^([A-G](?:#{1,2}|b{1,2}|♯{1,2}|♭{1,2})?)(.*?)(?:\/([A-G](?:#|b|♯|♭)?))?$/;

/** 解析和弦符号文本：'Gm7'、'C7(9)'、'F#m7b5'、'B♭M7'、'C/E'、'Cmaj7'。无法解析返回 null。 */
export function parseChordSymbol(text: string): ChordSymbol | null {
  const m = SYMBOL_RE.exec(text.trim());
  if (!m) return null;
  const [, rootName = '', qualityText = '', bassName] = m;
  const quality = QUALITY_ALIASES[qualityText];
  if (!quality) return null;
  const ascii = (s: string) => s.replace(/♯/g, '#').replace(/♭/g, 'b');
  return symbolFromNames(ascii(rootName), quality, bassName ? ascii(bassName) : undefined);
}
