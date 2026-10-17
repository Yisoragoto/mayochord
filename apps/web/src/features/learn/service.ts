import { BUILTIN_PACK } from '@mayochord/content';
import { create } from 'zustand';
import { dayParams, wallNow } from '@/lib/clock';
import { uuid } from '@/lib/uuid';
import { type DailyPlanRecord, tryRepositories } from '@/storage';
import { useSettings } from '@/stores/settings';
import { LearningService, type LearningSnapshot } from './learning';

export const learning = new LearningService({
  pack: BUILTIN_PACK,
  repos: tryRepositories,
  wallNow,
  uuid,
  day: dayParams,
  planParams: () => {
    const { dailyMinutes, newTopicsPerDay } = useSettings.getState().settings;
    return { minutes: dailyMinutes, newPerDay: newTopicsPerDay };
  },
  activeCourse: () => useSettings.getState().settings.activeCourse,
});

interface LearningState {
  loading: boolean;
  plan: DailyPlanRecord | null;
  snapshot: LearningSnapshot | null;
  error: boolean;
}

export const useLearning = create<LearningState>()(() => ({
  loading: false,
  plan: null,
  snapshot: null,
  error: false,
}));

/** 换当前课程：保存设置，把今天还没开始的新课换成这门课程的 */
export async function switchCourse(courseId: string): Promise<void> {
  const s = useSettings.getState();
  if (s.settings.activeCourse === courseId) return;
  await s.update({ activeCourse: courseId });
  useLearning.setState({ loading: true });
  try {
    await learning.applyCourseChange();
  } finally {
    await refreshLearning();
  }
}

/** 重新读取学习进度与今天的任务（regenerate：丢掉今天已生成的任务重新编排，开发用） */
export async function refreshLearning(regenerate = false): Promise<void> {
  useLearning.setState({ loading: true });
  try {
    const { plan, snapshot } = await learning.plan(regenerate);
    useLearning.setState({ loading: false, plan, snapshot, error: false });
  } catch {
    useLearning.setState({ loading: false, error: true });
  }
}
