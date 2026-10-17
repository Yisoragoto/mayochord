import { nameToMidi, spellInterval } from '../theory/notes';
import type { VoicedNote } from '../voicing/types';
import type { IntervalCard, IntervalName, NoteCard, StaffNoteCard } from './cards';

/** 音程名 → 度数与半音数 */
export const INTERVALS: Readonly<Record<IntervalName, { degree: number; semitones: number }>> = {
  m2: { degree: 2, semitones: 1 },
  M2: { degree: 2, semitones: 2 },
  m3: { degree: 3, semitones: 3 },
  M3: { degree: 3, semitones: 4 },
  P4: { degree: 4, semitones: 5 },
  P5: { degree: 5, semitones: 7 },
};

/** 不带八度的音名放进 C4–B4 */
function inOctave4(name: string): VoicedNote {
  for (const octave of [4, 3, 5]) {
    const midi = nameToMidi(`${name}${octave}`) as number;
    if (midi >= 60 && midi <= 71) return { name: `${name}${octave}`, midi, hand: 'right' };
  }
  throw new Error(`Invalid note ${name}`);
}

/** 认音名题的示范位置：C4–B4 里的那个音（判定时任意八度都算对） */
export function noteCardTarget(card: NoteCard): VoicedNote[] {
  return [{ ...inOctave4(card.note), finger: 2 }];
}

/** 音程题的示范位置：根音在 C4–B4，上方音按度数拼写 */
export function intervalCardTarget(card: IntervalCard): VoicedNote[] {
  const root = inOctave4(card.root);
  const { degree, semitones } = INTERVALS[card.interval];
  const upperName = spellInterval(root.name, degree, semitones);
  return [
    { ...root, finger: 1 },
    {
      name: upperName,
      midi: nameToMidi(upperName) as number,
      hand: 'right',
      finger: degree <= 2 ? 2 : 3,
    },
  ];
}

/** 看谱认音题的目标：谱上这个音本身（八度也要对）。右手谱表用右手，低音谱表用左手 */
export function staffNoteCardTarget(card: StaffNoteCard): VoicedNote[] {
  const midi = nameToMidi(card.pitch);
  if (midi === null) throw new Error(`Invalid note ${card.pitch}`);
  return [{ name: card.pitch, midi, hand: card.clef === 'treble' ? 'right' : 'left', finger: 2 }];
}
