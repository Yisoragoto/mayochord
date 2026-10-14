/** 音名与 MIDI 号的基础换算。中央 C = C4 = MIDI 60。 */

export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
export type Spelling = 'sharp' | 'flat';
export type Letter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
/** 流行音乐里没有调性语境时最常见的写法：降号为主，F# 用升号。 */
const DEFAULT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export const LETTERS: readonly Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC: Record<Letter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

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

/** 拼写过的音名：字母 + 升降（-2..2）+ 可选八度。 */
export interface SpelledNote {
  letter: Letter;
  /** 升降：+1 = ♯，-1 = ♭，±2 = 重升/重降 */
  alter: number;
  octave?: number;
}

const NOTE_RE = /^([A-Ga-g])(#{1,2}|b{1,2}|♯{1,2}|♭{1,2}|x)?(-?\d+)?$/;

/** 'Bb4'、'F#'、'B♭'、'Cx3' → SpelledNote；无法解析返回 null。 */
export function parseNoteName(name: string): SpelledNote | null {
  const m = NOTE_RE.exec(name.trim());
  if (!m) return null;
  const [, letter = '', acc = '', oct] = m;
  let alter = 0;
  for (const ch of acc) {
    if (ch === '#' || ch === '♯') alter += 1;
    else if (ch === 'x') alter += 2;
    else alter -= 1;
  }
  const note: SpelledNote = { letter: letter.toUpperCase() as Letter, alter };
  if (oct !== undefined) note.octave = Number(oct);
  return note;
}

/** SpelledNote → ASCII 音名，如 'Bb4'、'F#'、'Ebb'。 */
export function formatNoteName(n: SpelledNote): string {
  const acc = n.alter > 0 ? '#'.repeat(n.alter) : 'b'.repeat(-n.alter);
  return `${n.letter}${acc}${n.octave ?? ''}`;
}

export function spelledPitchClass(n: SpelledNote): PitchClass {
  return pitchClass(LETTER_PC[n.letter] + n.alter);
}

/** 'C4'、'Bb3'、'F#5'、'B♭4' → MIDI 号；没有八度或无法解析返回 null。 */
export function nameToMidi(name: string): number | null {
  const n = parseNoteName(name);
  if (!n || n.octave === undefined) return null;
  return (n.octave + 1) * 12 + LETTER_PC[n.letter] + n.alter;
}

/** 音级名（不含八度）→ 音级；无法解析返回 null。 */
export function nameToPitchClass(name: string): PitchClass | null {
  const n = parseNoteName(name);
  return n ? spelledPitchClass(n) : null;
}

/**
 * 按音程拼写：从 root 向上数 degree 度（1 = 同度，3 = 三度，9 = 九度…），相距 semitones 个半音。
 * 例：spellInterval('G', 3, 3) = 'Bb'；spellInterval('E', 3, 4) = 'G#'；spellInterval('C', 7, 9) = 'Bbb'。
 * root 可以带八度（'G3'），这时结果也带八度。
 */
export function spellInterval(root: string, degree: number, semitones: number): string {
  const r = parseNoteName(root);
  if (!r) throw new Error(`Invalid note name: ${root}`);
  const rootLetterIdx = LETTERS.indexOf(r.letter);
  const steps = degree - 1;
  const letter = LETTERS[(rootLetterIdx + steps) % 7] as Letter;
  const rootPc = LETTER_PC[r.letter] + r.alter;
  // 目标字母的自然音级（在根音之上的同一个八度序列里）
  const octaveCarry = Math.floor((rootLetterIdx + steps) / 7);
  const naturalAbsolute = LETTER_PC[letter] + 12 * octaveCarry;
  const alter = rootPc + semitones - naturalAbsolute;
  const out: SpelledNote = { letter, alter };
  if (r.octave !== undefined) out.octave = r.octave + octaveCarry;
  return formatNoteName(out);
}

/** 把 ASCII 升降号换成音乐字形：'Bb' → 'B♭'，'F#' → 'F♯'，重降 'Ebb' → 'E♭♭'。 */
export function prettyAccidentals(s: string): string {
  return s.replace(/([A-G])(##|bb|#|b)/g, (_, l: string, a: string) => {
    const map: Record<string, string> = { '#': '♯', '##': '♯♯', b: '♭', bb: '♭♭' };
    return l + (map[a] ?? a);
  });
}

export function isBlackKey(midi: number): boolean {
  const pc = pitchClass(midi);
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}
