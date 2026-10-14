import { type ChordQuality, chordQualityDef } from '../theory/chord-symbol';
import { nameToPitchClass, pitchClass } from '../theory/notes';

export type Inversion = 'root' | 'first' | 'second' | 'third';

export interface RightHandShape {
  /** 右手最低音是和弦的几度（1、3、5、7、9）；不是和弦音时为 null */
  lowestDegree: number | null;
  /** 只有右手包含根音时才谈转位：最低音为根音=原位，三音=第一转位，五音=第二转位，七音=第三转位 */
  inversion: Inversion | null;
}

const BY_DEGREE: Record<number, Inversion> = { 1: 'root', 3: 'first', 5: 'second', 7: 'third' };

export function describeRightHand(
  rh: readonly number[],
  rootName: string,
  quality: ChordQuality,
): RightHandShape {
  const rootPc = nameToPitchClass(rootName);
  if (rootPc === null) throw new Error(`Invalid root name: ${rootName}`);
  const degreeOfPc = new Map<number, number>();
  for (const t of chordQualityDef(quality).tones) {
    degreeOfPc.set(pitchClass(rootPc + t.semitones), t.degree);
  }
  if (rh.length === 0) return { lowestDegree: null, inversion: null };
  const lowest = Math.min(...rh);
  const lowestDegree = degreeOfPc.get(pitchClass(lowest)) ?? null;
  const hasRoot = rh.some((n) => pitchClass(n) === rootPc);
  return {
    lowestDegree,
    inversion: hasRoot && lowestDegree !== null ? (BY_DEGREE[lowestDegree] ?? null) : null,
  };
}
