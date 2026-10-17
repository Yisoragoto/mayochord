import { BUILTIN_PACK } from '@mayochord/content';
import { createDefaultStrategy, sourceKind } from '@mayochord/core';
import { useStore } from 'zustand';
import { playFeedbackSound } from '@/audio/feedback-sound';
import { playRhythm } from '@/audio/rhythm-play';
import { liveInput } from '@/input/live';
import { dayParams, wallNow } from '@/lib/clock';
import { uuid } from '@/lib/uuid';
import { tryRepositories } from '@/storage';
import { useSettings } from '@/stores/settings';
import { RhythmSessionController, type RhythmView } from './rhythm-session';

/** 应用里唯一的节奏读谱控制器（M10） */
export const rhythmSession = new RhythmSessionController({
  pack: BUILTIN_PACK,
  repos: tryRepositories,
  strategy: () => createDefaultStrategy({ progress: { day: dayParams() } }),
  play: (rhythm, demo, onBeat) =>
    playRhythm(rhythm.pattern, rhythm.time, rhythm.bpm, {
      demo,
      volume: useSettings.getState().settings.metronomeVolume,
      onBeat,
    }),
  onNoteOn: (cb) =>
    liveInput.onEvent((e) => {
      if (e.kind === 'noteOn') cb(e.t, e.source);
    }),
  latencyMs: () => useSettings.getState().settings.latencyOffsetMs,
  now: () => performance.now(),
  wallNow,
  uuid,
  sourceKind,
  onResult: (correct) => {
    if (useSettings.getState().settings.feedbackSound) {
      playFeedbackSound(correct ? 'correct' : 'wrong');
    }
  },
});

export function useRhythmSession<T>(selector: (v: RhythmView) => T): T {
  return useStore(rhythmSession.store, selector);
}
