import { BUILTIN_PACK } from '@mayochord/content';
import { createDefaultStrategy } from '@mayochord/core';
import { useStore } from 'zustand';
import { playFeedbackSound } from '@/audio/feedback-sound';
import { liveInput, useLiveInput } from '@/input/live';
import { releaseOnscreenNotes } from '@/input/PlayableKeyboard';
import { uuid } from '@/lib/uuid';
import { tryRepositories } from '@/storage';
import { useSettings } from '@/stores/settings';
import { PracticeController, type PracticeView } from './controller';
import { practiceGroups } from './groups';

export const PRACTICE_GROUPS = practiceGroups(BUILTIN_PACK);

/** 应用里唯一的练习控制器 */
export const practice = new PracticeController({
  pack: BUILTIN_PACK,
  groups: PRACTICE_GROUPS,
  repos: tryRepositories,
  strategy: () =>
    createDefaultStrategy({
      progress: { day: { dayStartHour: 4, tzOffsetMinutes: new Date().getTimezoneOffset() } },
    }),
  onAttempt: (cb) => liveInput.onAttempt(cb),
  heldNow: () => useLiveInput.getState().held,
  onsetWindowMs: () => useSettings.getState().settings.onsetWindowMs,
  now: () => performance.now(),
  wallNow: () => Date.now(),
  uuid,
  nextDelayMs: (firstTryCorrect) => (firstTryCorrect ? 650 : 900),
  onTrialDone: (state) => {
    // 点击切换模式下，看名弹和弦每题结束自动松开屏幕键盘上的音（切换题要沿用当前和弦，不松开）
    const { onscreenMode } = useSettings.getState().settings;
    if (onscreenMode === 'latch' && state.trial.drillType === 'name-to-chord') {
      releaseOnscreenNotes();
    }
  },
  onResult: (r) => {
    if (useSettings.getState().settings.feedbackSound) {
      playFeedbackSound(r.correct ? 'correct' : 'wrong');
    }
  },
});

export function usePractice<T>(selector: (v: PracticeView) => T): T {
  return useStore(practice.store, selector);
}
