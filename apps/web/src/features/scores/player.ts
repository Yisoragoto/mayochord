import { useStore } from 'zustand';
import { startMetronome } from '@/audio/metronome';
import { getPiano, readyPiano } from '@/audio/piano';
import { perfToContextTime } from '@/audio/tone';
import { liveInput } from '@/input/live';
import { wallNow } from '@/lib/clock';
import { uuid } from '@/lib/uuid';
import { tryRepositories } from '@/storage';
import { useSettings } from '@/stores/settings';
import { type PlayerView, ScorePlayer } from './score-player';

/** 应用里唯一的曲谱跟弹控制器 */
export const scorePlayer = new ScorePlayer({
  onNoteOn: (cb) =>
    liveInput.onEvent((e) => {
      if (e.kind === 'noteOn') cb(e.note, e.t);
    }),
  startMetronome: async (o) => {
    const m = await startMetronome({
      bpm: o.bpm,
      beatsPerBar: o.beatsPerBar,
      mode: o.click ? 'all' : 'off',
      accent: true,
      countInBeats: o.countInBeats,
      volume: useSettings.getState().settings.metronomeVolume,
    });
    return { startT: m.grid.startT, stop: () => m.stop() };
  },
  preparePiano: async () => {
    await getPiano();
  },
  playNow: (pitches, durMs) => readyPiano()?.playNotes(pitches, { duration: durMs / 1000 }),
  playAt: (pitches, perfT, durMs) => {
    const time = perfToContextTime(perfT);
    if (time !== null) readyPiano()?.playAt(pitches, time, durMs / 1000);
  },
  silence: () => readyPiano()?.releaseAll(),
  repos: tryRepositories,
  now: () => performance.now(),
  wallNow,
  uuid,
});

export function usePlayer<T>(selector: (v: PlayerView) => T): T {
  return useStore(scorePlayer.store, selector);
}
