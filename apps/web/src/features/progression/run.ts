import { BUILTIN_PACK } from '@mayochord/content';
import { createDefaultStrategy } from '@mayochord/core';
import { useStore } from 'zustand';
import { startMetronome } from '@/audio/metronome';
import { liveInput } from '@/input/live';
import { dayParams, wallNow } from '@/lib/clock';
import { uuid } from '@/lib/uuid';
import { tryRepositories } from '@/storage';
import { useSettings } from '@/stores/settings';
import { ProgressionRunController, type RunView } from './run-controller';

/** 应用里唯一的进行练习控制器 */
export const progressionRun = new ProgressionRunController({
  pack: BUILTIN_PACK,
  repos: tryRepositories,
  strategy: () => createDefaultStrategy({ progress: { day: dayParams() } }),
  onAttempt: (cb) => liveInput.onAttempt(cb),
  startMetronome: (c) =>
    startMetronome({
      bpm: c.spec.bpm,
      beatsPerBar: c.spec.beatsPerBar,
      mode: c.click.mode,
      accent: c.click.accent,
      countInBeats: c.spec.countInBeats,
      volume: useSettings.getState().settings.metronomeVolume,
    }),
  now: () => performance.now(),
  wallNow,
  uuid,
});

export function useRun<T>(selector: (v: RunView) => T): T {
  return useStore(progressionRun.store, selector);
}
