import { type ChordQuality, chordQualityDef, chordTones } from '../theory/chord-symbol';
import { nameToMidi, nameToPitchClass } from '../theory/notes';
import type { Finger, VoicedNote } from './types';

const RH_FINGERS: Record<number, Finger[]> = {
  1: [1],
  2: [1, 3],
  3: [1, 3, 5],
  4: [1, 2, 3, 5],
};

/** 把不带八度的音名放到 [low, low+11] 里的那个八度 */
function placeInWindow(name: string, low: number): { name: string; midi: number } {
  for (let octave = 1; octave <= 7; octave++) {
    const midi = nameToMidi(`${name}${octave}`) as number;
    if (midi >= low && midi <= low + 11) return { name: `${name}${octave}`, midi };
  }
  throw new Error(`Cannot place ${name}`);
}

/** 放到 prev 之上最近的位置 */
function placeAbove(name: string, prev: number): { name: string; midi: number } {
  for (let octave = 1; octave <= 8; octave++) {
    const midi = nameToMidi(`${name}${octave}`) as number;
    if (midi > prev) return { name: `${name}${octave}`, midi };
  }
  throw new Error(`Cannot place ${name}`);
}

/**
 * 自动生成的"密集排列"键位（内容包里没有给键位的和弦用）：
 * - 左手：根音（斜杠和弦为低音），C3–B3；
 * - 右手：从根音开始按叠置顺序排列（斜杠和弦从低音那个和弦音开始，即对应的转位），最低音在 C4–B4；
 *   五个音的和弦（九和弦）省略五音，右手最多四个音。
 * 用于课程讲解和提示；判定时一般用宽松模式。
 */
export function closeVoicing(
  rootName: string,
  quality: ChordQuality,
  bassName?: string,
): VoicedNote[] {
  const def = chordQualityDef(quality);
  let tones = chordTones(rootName, quality);
  if (tones.length > 4) tones = tones.filter((_, i) => def.tones[i]?.degree !== 5);
  if (bassName !== undefined) {
    const bassPc = nameToPitchClass(bassName);
    const idx = tones.findIndex((t) => nameToPitchClass(t) === bassPc);
    if (idx > 0) tones = [...tones.slice(idx), ...tones.slice(0, idx)];
  }
  const right: { name: string; midi: number }[] = [];
  for (const t of tones) {
    const prev = right[right.length - 1];
    right.push(prev ? placeAbove(t, prev.midi) : placeInWindow(t, 60));
  }
  const fingers = RH_FINGERS[right.length] ?? [];
  const left = placeInWindow(bassName ?? rootName, 48);
  return [
    { name: left.name, midi: left.midi, hand: 'left', finger: 5 },
    ...right.map((n, i): VoicedNote => {
      const note: VoicedNote = { name: n.name, midi: n.midi, hand: 'right' };
      const f = fingers[i];
      if (f !== undefined) note.finger = f;
      return note;
    }),
  ];
}
