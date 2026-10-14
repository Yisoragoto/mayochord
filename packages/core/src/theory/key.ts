import { type ChordQuality, chordQualityDef } from './chord-symbol';
import { LETTERS, parseNoteName, spelledPitchClass, spellInterval } from './notes';

/** 大调音阶各级相对主音的半音数。目前内容只用到大调。 */
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;

export interface MajorKey {
  tonic: string;
}

/** 大调音阶的拼写，例如 majorScale('G') = ['G', 'A', 'B', 'C', 'D', 'E', 'F#']。 */
export function majorScale(tonic: string): string[] {
  return MAJOR_SCALE.map((semis, i) => spellInterval(tonic, i + 1, semis));
}

/**
 * 根音在调中的级数：degree 1–7 与相对大调音阶的升降。
 * 例：C 调里 'Bb' → { degree: 7, alter: -1 }，'E' → { degree: 3, alter: 0 }。
 */
export function scaleDegree(rootName: string, key: MajorKey): { degree: number; alter: number } {
  const r = parseNoteName(rootName);
  const t = parseNoteName(key.tonic);
  if (!r || !t) throw new Error(`Invalid note name: ${rootName} / ${key.tonic}`);
  const steps = (LETTERS.indexOf(r.letter) - LETTERS.indexOf(t.letter) + 7) % 7;
  const expected = (spelledPitchClass(t) + (MAJOR_SCALE[steps] as number)) % 12;
  let alter = spelledPitchClass(r) - expected;
  if (alter > 6) alter -= 12;
  if (alter < -6) alter += 12;
  return { degree: steps + 1, alter };
}

/**
 * 级数写法。
 * - 'jp'：日本流行乐常用写法，罗马数字一律大写，后面跟和弦性质：IVM7、III7、VIm7、Vm7、I7(9)
 * - 'case'：大小写区分大小三和弦：IV、V、iii、vi；ii7、V7、IM7；vii°、viiø7
 */
export type RomanStyle = 'jp' | 'case';

const CASE_SUFFIX: Partial<Record<ChordQuality, string>> = {
  m: '',
  m6: '6',
  m7: '7',
  'm7(9)': '7(9)',
  m7b5: 'ø7',
  dim: '°',
  dim7: '°7',
  mM7: 'M7',
  madd9: 'add9',
};

export function romanNumeral(
  rootName: string,
  quality: ChordQuality,
  key: MajorKey,
  style: RomanStyle = 'jp',
): string {
  const { degree, alter } = scaleDegree(rootName, key);
  const acc = alter > 0 ? '♯'.repeat(alter) : '♭'.repeat(-alter);
  const numeral = ROMAN[degree - 1] as string;
  const def = chordQualityDef(quality);
  const suffix = `${def.display.main}${def.display.ext}`;
  if (style === 'jp') return `${acc}${numeral}${suffix}`;
  const lower = def.minorThird;
  const caseSuffix = lower ? (CASE_SUFFIX[quality] ?? suffix) : suffix;
  return `${acc}${lower ? numeral.toLowerCase() : numeral}${caseSuffix}`;
}
