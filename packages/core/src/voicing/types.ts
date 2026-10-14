export type Hand = 'left' | 'right';
export type Finger = 1 | 2 | 3 | 4 | 5;

/** 键位里的一个音。name 保留拼写（'Bb4' 而不是 'A#4'），midi 由 name 计算。 */
export interface VoicedNote {
  name: string;
  midi: number;
  hand: Hand;
  finger?: Finger;
}

export type VoicingStatus = 'confirmed' | 'tentative';

export interface Voicing {
  id: string;
  chordId: string;
  notes: readonly VoicedNote[];
  /** tentative = 按规则设计、尚待用户确认的键位 */
  status: VoicingStatus;
}

export function voicingMidi(v: Voicing): number[] {
  return v.notes.map((n) => n.midi).sort((a, b) => a - b);
}

export function handMidi(v: Voicing, hand: Hand): number[] {
  return v.notes
    .filter((n) => n.hand === hand)
    .map((n) => n.midi)
    .sort((a, b) => a - b);
}
