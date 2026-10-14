import { CHORD_QUALITIES, type ChordQualityDef, type ChordSymbol } from '../theory/chord-symbol';
import { type PitchClass, pitchClass } from '../theory/notes';

/** 自由识别的一个候选解释。 */
export interface ChordCandidate {
  symbol: ChordSymbol;
  /** 是否省略了五音 */
  omit5: boolean;
  /** 排序分数，越大越优先 */
  score: number;
}

const SLASH_PENALTY = 3;
const OMIT5_PENALTY = 0.5;
const ROOT_IN_BASS_BONUS = 1;

function intervalMask(intervals: Iterable<number>): number {
  let mask = 0;
  for (const i of intervals) mask |= 1 << (((i % 12) + 12) % 12);
  return mask;
}

interface Template {
  def: ChordQualityDef;
  mask: number;
  omit5: boolean;
}

const TEMPLATES: readonly Template[] = CHORD_QUALITIES.flatMap((def) => {
  const full: Template = { def, mask: intervalMask(def.intervals), omit5: false };
  if (!def.omit5Allowed) return [full];
  const without5 = def.intervals.filter((i) => i !== 7);
  return [full, { def, mask: intervalMask(without5), omit5: true }];
});

/**
 * 自由识别：按住的音 → 所有可能的和弦解释，按常见程度排序。
 * 忽略八度与重复音；最低音不是根音时给出斜杠和弦。少于 3 个不同音级时返回空数组。
 */
export function identifyChord(midiNotes: readonly number[]): ChordCandidate[] {
  if (midiNotes.length === 0) return [];
  const pcs = new Set<PitchClass>(midiNotes.map(pitchClass));
  if (pcs.size < 3) return [];
  const bass = pitchClass(Math.min(...midiNotes));

  const results: ChordCandidate[] = [];
  for (const root of pcs) {
    const mask = intervalMask(Array.from(pcs, (pc) => pc - root));
    for (const t of TEMPLATES) {
      if (t.mask !== mask) continue;
      const isSlash = root !== bass;
      const symbol: ChordSymbol = isSlash
        ? { root, quality: t.def.quality, bass }
        : { root, quality: t.def.quality };
      const score =
        t.def.commonness -
        (isSlash ? SLASH_PENALTY : -ROOT_IN_BASS_BONUS) -
        (t.omit5 ? OMIT5_PENALTY : 0);
      results.push({ symbol, omit5: t.omit5, score });
    }
  }
  return results.sort((a, b) => b.score - a.score);
}
