import { encompassedWeights, type TopicGraph } from '../graph/topic-graph';
import { type TopicProgress, topicStatus } from '../graph/topic-progress';
import { DEFAULT_FSRS, retrievability } from './memory';
import { type CardProgress, type DayParams, dayKey } from './progress';

/**
 * 每日任务自动编排（规格 6.5）：
 * 1. 热身：上一个练习日练过的卡片（最多 warmupCards 张，约 2–3 分钟）；
 * 2. 到期复习：优先选能顺带覆盖其他到期主题的（它包含的到期主题权重 ≥ coverWeight 时不再单独复习，
 *    靠隐式重复得到信用）；复习任务混合 2–3 个主题的卡片（交错）；
 * 3. 新课：先继续"学习中"的课程，再按图谱顺序开始新主题；每天新课有上限；
 *    同一个干扰组（例如 M7 与 7）的主题不在同一天引入；
 * 4. 总时长不超过每天的目标时长（至少安排一节课，除非复习已经占满）。
 * 测验在 M6 加入。
 */
export interface TopicPlanInfo {
  id: string;
  cardIds: readonly string[];
  /** 一节课的预计时长（分钟） */
  lessonMinutes: number;
}

export interface PlanParams {
  minutes: number;
  newPerDay: number;
  warmupCards: number;
  warmupMinutes: number;
  reviewCardsPerTopic: number;
  topicsPerReviewTask: number;
  /** 每道复习题的预计用时（秒） */
  secondsPerQuestion: number;
  coverWeight: number;
}

export const DEFAULT_PLAN: PlanParams = {
  minutes: 30,
  newPerDay: 2,
  warmupCards: 8,
  warmupMinutes: 3,
  reviewCardsPerTopic: 5,
  topicsPerReviewTask: 3,
  secondsPerQuestion: 15,
  coverWeight: 0.5,
};

export type TaskKind = 'warmup' | 'review' | 'lesson';

export interface PlannedTask {
  id: string;
  kind: TaskKind;
  topicIds: string[];
  cardIds: string[];
  minutes: number;
  /** 复习任务：预计顺带得到隐式信用的到期主题 */
  covers: string[];
}

export interface DailyPlanDraft {
  date: string;
  tasks: PlannedTask[];
  /** 今天到期的主题 */
  dueTopics: string[];
  /** 没排进今天的可学习主题（"换一个"时用） */
  spareLessons: string[];
}

export interface PlanInput {
  now: number;
  day: DayParams;
  graph: TopicGraph;
  topics: ReadonlyMap<string, TopicPlanInfo>;
  topicProgress: ReadonlyMap<string, TopicProgress>;
  cardProgress: ReadonlyMap<string, CardProgress>;
  /** 上一个练习日练过的卡片 ID（按时间顺序） */
  recentCardIds: readonly string[];
  params?: Partial<PlanParams>;
}

/** 练习日结束（下一个练习日开始）的时间戳 */
export function endOfPracticeDay(now: number, day: DayParams): number {
  const date = dayKey(now, day);
  return (
    Date.parse(`${date}T00:00:00Z`) +
    86_400_000 +
    day.dayStartHour * 3_600_000 +
    day.tzOffsetMinutes * 60_000
  );
}

/** 复习时从一个主题里挑卡片：到期的最优先（越早到期越靠前），然后是回忆概率低的，没练过的排最后 */
export function selectReviewCards(
  info: TopicPlanInfo,
  cards: ReadonlyMap<string, CardProgress>,
  end: number,
  now: number,
  n: number,
): string[] {
  const score = (id: string) => {
    const m = cards.get(id)?.memory ?? null;
    if (!m) return 2; // 没练过的卡排后面
    if (m.due < end) return -1 + (m.due - now) / 1e13; // 到期的最优先，越早到期越靠前
    return retrievability(m, now, DEFAULT_FSRS) ?? 1;
  };
  return [...info.cardIds].sort((a, b) => score(a) - score(b)).slice(0, n);
}

/** 把几个列表轮流交错合并 */
function interleave(lists: readonly string[][]): string[] {
  const out: string[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++)
    for (const l of lists) if (l[i] !== undefined) out.push(l[i] as string);
  return out;
}

export function planDay(input: PlanInput): DailyPlanDraft {
  const p = { ...DEFAULT_PLAN, ...input.params };
  const { graph, topics, topicProgress, cardProgress, now } = input;
  const date = dayKey(now, input.day);
  const end = endOfPracticeDay(now, input.day);
  const tasks: PlannedTask[] = [];
  let used = 0;
  const taskId = (kind: TaskKind) =>
    `${date}:${kind}:${tasks.filter((t) => t.kind === kind).length + 1}`;

  // 1. 热身
  const known = new Set([...topics.values()].flatMap((t) => t.cardIds));
  const warm = [...new Set(input.recentCardIds)]
    .filter((id) => known.has(id))
    .slice(-p.warmupCards);
  if (warm.length > 0) {
    tasks.push({
      id: taskId('warmup'),
      kind: 'warmup',
      topicIds: [],
      cardIds: warm,
      minutes: p.warmupMinutes,
      covers: [],
    });
    used += p.warmupMinutes;
  }

  // 2. 到期复习
  const due = graph.order.filter((id) => {
    const tp = topicProgress.get(id);
    return tp?.masteredAt != null && tp.memory !== null && tp.memory.due < end && topics.has(id);
  });
  due.sort(
    (a, b) =>
      (topicProgress.get(a)?.memory?.due as number) - (topicProgress.get(b)?.memory?.due as number),
  );
  const remaining = new Set(due);
  const selected: { id: string; covers: string[] }[] = [];
  while (remaining.size > 0) {
    let best: { id: string; covers: string[] } | null = null;
    for (const id of due) {
      if (!remaining.has(id)) continue;
      const w = encompassedWeights(graph, id);
      const covers = [...remaining].filter((o) => o !== id && (w.get(o) ?? 0) >= p.coverWeight);
      if (!best || covers.length > best.covers.length) best = { id, covers };
    }
    const chosen = best as { id: string; covers: string[] };
    selected.push(chosen);
    remaining.delete(chosen.id);
    for (const c of chosen.covers) remaining.delete(c);
  }
  for (let i = 0; i < selected.length; i += p.topicsPerReviewTask) {
    const group = selected.slice(i, i + p.topicsPerReviewTask);
    const cardIds = interleave(
      group.map((g) =>
        selectReviewCards(
          topics.get(g.id) as TopicPlanInfo,
          cardProgress,
          end,
          now,
          p.reviewCardsPerTopic,
        ),
      ),
    );
    const minutes = Math.max(1, Math.round((cardIds.length * p.secondsPerQuestion) / 60));
    tasks.push({
      id: taskId('review'),
      kind: 'review',
      topicIds: group.map((g) => g.id),
      cardIds,
      minutes,
      covers: group.flatMap((g) => g.covers),
    });
    used += minutes;
  }

  // 3. 新课
  const status = (id: string) => topicStatus(graph, topicProgress, id, now);
  const learning = graph.order.filter((id) => status(id) === 'learning' && topics.has(id));
  const available = graph.order.filter((id) => status(id) === 'available' && topics.has(id));
  const groups = new Set<string>();
  const lessons: string[] = [];
  const spare: string[] = [];
  for (const id of [...learning, ...available]) {
    const info = topics.get(id) as TopicPlanInfo;
    const group = graph.byId.get(id)?.interferenceGroup;
    const fits =
      lessons.length < p.newPerDay &&
      !(group && groups.has(group)) &&
      (used + info.lessonMinutes <= p.minutes || (lessons.length === 0 && used < p.minutes));
    if (!fits) {
      spare.push(id);
      continue;
    }
    lessons.push(id);
    if (group) groups.add(group);
    used += info.lessonMinutes;
    tasks.push({
      id: taskId('lesson'),
      kind: 'lesson',
      topicIds: [id],
      cardIds: [...info.cardIds],
      minutes: info.lessonMinutes,
      covers: [],
    });
  }

  return { date, tasks, dueTopics: due, spareLessons: spare };
}
