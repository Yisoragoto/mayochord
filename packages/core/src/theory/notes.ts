/** 音名与 MIDI 号的基础换算。中央 C = C4 = MIDI 60。 */

export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
export type Spelling = 'sharp' | 'flat';

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
/** 流行音乐里没有调性语境时最常见的写法：降号为主，F# 用升号。 */
const DEFAULT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export function pitchClass(midi: number): PitchClass {
  return (((midi % 12) + 12) % 12) as PitchClass;
}

export function octaveOf(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

/** 音级的 ASCII 名称（'C'、'Bb'、'F#'）。spelling 省略时用默认写法。 */
export function pitchClassName(pc: number, spelling?: Spelling): string {
  const table =
    spelling === 'sharp' ? SHARP_NAMES : spelling === 'flat' ? FLAT_NAMES : DEFAULT_NAMES;
  return table[pitchClass(pc)] as string;
}

/** MIDI 号 → 'C4'、'Bb3'（ASCII）。 */
export function midiToName(midi: number, spelling?: Spelling): string {
  return `${pitchClassName(midi, spelling)}${octaveOf(midi)}`;
}

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C4'、'Bb3'、'F#5'、'B♭4' → MIDI 号；无法解析返回 null。 */
export function nameToMidi(name: string): number | null {
  const m = /^([A-Ga-g])([#b♯♭]{0,2})(-?\d+)$/.exec(name.trim());
  if (!m) return null;
  const [, letter = '', acc = '', oct = ''] = m;
  let pc = LETTER_PC[letter.toUpperCase()] ?? 0;
  for (const ch of acc) pc += ch === '#' || ch === '♯' ? 1 : -1;
  return (Number(oct) + 1) * 12 + pc;
}

/** 把 ASCII 升降号换成音乐字形：'Bb' → 'B♭'，'F#' → 'F♯'。 */
export function prettyAccidentals(s: string): string {
  return s.replace(/([A-G])(#|b)/g, (_, l: string, a: string) => l + (a === '#' ? '♯' : '♭'));
}

export function isBlackKey(midi: number): boolean {
  const pc = pitchClass(midi);
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}
