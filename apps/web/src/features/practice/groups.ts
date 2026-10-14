import type { I18nText, LoadedPack } from '@mayochord/content';
import {
  type AnyCard,
  chordCardsFor,
  type DrillType,
  transitionCardsFor,
  type VoicingMode,
} from '@mayochord/core';

/**
 * 练习用的和弦组（M2 的临时入口；M3 起由知识图谱和每日任务决定练什么）。
 * 每条进行是一组（顺序 = 进行顺序，循环），另有"全部和弦"（没有顺序，不能练切换）。
 */
export interface PracticeGroup {
  id: string;
  name: I18nText | null;
  chordIds: string[];
  /** 是否有固定顺序（能练和弦切换） */
  sequence: boolean;
}

export const ALL_CHORDS_GROUP = 'all';

export function practiceGroups(pack: LoadedPack): PracticeGroup[] {
  return [
    ...pack.progressions.map((p) => ({
      id: p.id,
      name: p.name,
      chordIds: p.steps.map((s) => s.chord.id),
      sequence: true,
    })),
    { id: ALL_CHORDS_GROUP, name: null, chordIds: pack.chords.map((c) => c.id), sequence: false },
  ];
}

export function cardsForGroup(
  group: PracticeGroup,
  drill: DrillType,
  voicingMode: VoicingMode,
): AnyCard[] {
  if (drill === 'transition') {
    return group.sequence ? transitionCardsFor(group.chordIds, { cyclic: true, voicingMode }) : [];
  }
  return chordCardsFor(group.chordIds, { voicingMode });
}
