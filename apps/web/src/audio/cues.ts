import type { ChordEntry } from '@mayochord/content';
import { closeVoicing, majorScale, voicingMidi } from '@mayochord/core';
import { getPiano } from './piano';

/** 终止式里每个和弦的时值（秒）与终止式之后的停顿 */
const CADENCE_STEP = 0.7;
const CADENCE_GAP = 0.45;

/** 大调的 I–IV–V–I（密集排列），用来确立调性（规格 10：听辨先播放终止式） */
export function cadenceNotes(key: string): number[][] {
  const scale = majorScale(key);
  const triad = (degree: number) => closeVoicing(scale[degree] as string, 'maj').map((n) => n.midi);
  return [triad(0), triad(3), triad(4), triad(0)];
}

/**
 * 播放听辨题：key 不为 null 时先播放这个调的终止式，再播放目标和弦。
 * 返回从现在到目标和弦响起的毫秒数（从那一刻开始计时）。
 */
export async function playChordCue(
  chord: ChordEntry,
  key: string | null,
  withCadence = true,
): Promise<number> {
  const piano = await getPiano();
  let delay = 0;
  if (key && withCadence) {
    for (const notes of cadenceNotes(key)) {
      piano.playNotes(notes, { delay, duration: CADENCE_STEP * 0.95, velocity: 64 });
      delay += CADENCE_STEP;
    }
    delay += CADENCE_GAP;
  }
  piano.playNotes(voicingMidi(chord.reference), { delay, duration: 2.2, velocity: 84 });
  return Math.round((delay + 0.02) * 1000);
}
