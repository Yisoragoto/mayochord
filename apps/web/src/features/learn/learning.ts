import type { LoadedPack, TopicEntry } from '@mayochord/content';
import {
  type AnyCard,
  allPrerequisites,
  applyTopicLog,
  type CardProgress,
  type DayParams,
  dayKey,
  emptyTopicProgress,
  endOfPracticeDay,
  implicitCredits,
  masteryPassed,
  type PlanParams,
  planDay,
  type Rating,
  type ReviewLog,
  replayTopicProgress,
  runPassed,
  TOPIC_CARD_PREFIX,
  type TopicLogType,
  type TopicPlanInfo,
  type TopicProgress,
  type TopicStatus,
  topicCardId,
  topicRating,
  topicStatuses,
} from '@mayochord/core';
import type { DailyPlanRecord, Repositories, StoredTask } from '@/storage';
import type { SessionResult } from '../practice/controller';
import type { RunResult } from '../progression/run-controller';

export interface LearningDeps {
  pack: LoadedPack;
  repos: () => Repositories | null;
  wallNow: () => number;
  uuid: () => string;
  day: () => DayParams;
  planParams: () => Partial<PlanParams>;
}

export interface LearningSnapshot {
  now: number;
  date: string;
  topicProgress: Map<string, TopicProgress>;
  cardProgress: Map<string, CardProgress>;
  statuses: Map<string, TopicStatus>;
  /** 上次测验的时间（没有测过为 null） */
  lastQuizAt: number | null;
}

/** 上次测验答错的卡片（针对性补救），存在 settings 表 */
const REMEDIATION_KEY = 'remediation';
interface Remediation {
  at: number;
  cardIds: string[];
}

export interface TopicOutcome {
  topicId: string;
  total: number;
  correct: number;
  accuracy: number;
  rating: Rating | null;
  passed: boolean;
}

const DAY = 86_400_000;

/**
 * 学习进度与每日任务：主题进度由主题日志重放得到（日志不多，每次都重放，保证与日志一致）；
 * 每日任务第一次打开"今天"时生成并保存，当天内保持不变（可以跳过、替换）。
 */
export class LearningService {
  constructor(private readonly deps: LearningDeps) {}

  private repos(): Repositories | null {
    try {
      return this.deps.repos();
    } catch {
      return null;
    }
  }

  topic(id: string): TopicEntry | undefined {
    return this.deps.pack.topicById.get(id);
  }

  async snapshot(): Promise<LearningSnapshot> {
    const now = this.deps.wallNow();
    const repos = this.repos();
    const [topicLogs, cards] = repos
      ? await Promise.all([
          repos.reviewLogs.byCardPrefix(TOPIC_CARD_PREFIX),
          repos.cardStates.all(),
        ])
      : [[], []];
    const params = this.topicParams();
    const byTopic = new Map<string, ReviewLog[]>();
    for (const l of topicLogs) {
      const id = l.cardId.slice(TOPIC_CARD_PREFIX.length);
      byTopic.set(id, [...(byTopic.get(id) ?? []), l]);
    }
    const topicProgress = new Map<string, TopicProgress>();
    for (const t of this.deps.pack.topics) {
      topicProgress.set(t.id, replayTopicProgress(t.id, byTopic.get(t.id) ?? [], params));
    }
    const quizzes = topicLogs.filter((l) => l.drillType === 'quiz').map((l) => l.ts);
    return {
      now,
      date: dayKey(now, this.deps.day()),
      topicProgress,
      cardProgress: new Map(cards.map((c) => [c.cardId, c])),
      statuses: topicStatuses(this.deps.pack.graph, topicProgress, now),
      lastQuizAt: quizzes.length > 0 ? Math.max(...quizzes) : null,
    };
  }

  private topicParams() {
    return {
      fsrs: { requestRetention: 0.9, maximumInterval: 365, enableFuzz: false },
      day: this.deps.day(),
      minEarlyFactor: 0.1,
    };
  }

  /** 今天的任务：已生成则读取，否则按当前进度生成并保存 */
  async plan(regenerate = false): Promise<{ plan: DailyPlanRecord; snapshot: LearningSnapshot }> {
    const snapshot = await this.snapshot();
    const repos = this.repos();
    const existing = regenerate ? undefined : await repos?.dailyPlans.get(snapshot.date);
    if (existing) {
      // 新课在别处（例如从图谱进入）已经通过了掌握检查：任务同步为完成
      let changed = false;
      const tasks = existing.tasks.map((t) => {
        const mastered = snapshot.topicProgress.get(t.topicIds[0] ?? '')?.masteredAt;
        if (t.kind !== 'lesson' || t.status === 'done' || mastered == null) return t;
        changed = true;
        return { ...t, status: 'done' as const, completedAt: mastered };
      });
      if (!changed) return { plan: existing, snapshot };
      const plan = { ...existing, tasks };
      await repos?.dailyPlans.put(plan);
      return { plan, snapshot };
    }

    const topics = new Map<string, TopicPlanInfo>(
      this.deps.pack.topics.map((t) => [
        t.id,
        {
          id: t.id,
          cardIds: t.cards.map((c) => c.id),
          lessonMinutes: t.lesson.minutes,
          separate: t.practice.kind === 'rhythms',
        },
      ]),
    );
    const draft = planDay({
      now: snapshot.now,
      day: this.deps.day(),
      graph: this.deps.pack.graph,
      topics,
      topicProgress: snapshot.topicProgress,
      cardProgress: snapshot.cardProgress,
      recentCardIds: await this.lastPracticeDayCards(snapshot.now),
      lastQuizAt: snapshot.lastQuizAt,
      remediationCardIds: await this.remediationCards(),
      params: this.deps.planParams(),
    });
    const plan: DailyPlanRecord = {
      date: draft.date,
      createdAt: snapshot.now,
      tasks: draft.tasks.map((t) => ({
        ...t,
        status: 'pending',
        completedAt: null,
        xp: 0,
        result: null,
      })),
      dueTopics: draft.dueTopics,
      spareLessons: draft.spareLessons,
    };
    await repos?.dailyPlans.put(plan);
    return { plan, snapshot };
  }

  /** 上一个练习日（今天之前最近一个有作答的日子）练过的卡片 */
  /** 上次测验答错、之后还没答对过的卡片 */
  async remediationCards(): Promise<string[]> {
    const repos = this.repos();
    if (!repos) return [];
    const raw = (await repos.settings.get(REMEDIATION_KEY)) as Remediation | undefined;
    if (!raw || !Array.isArray(raw.cardIds)) return [];
    const fixed = new Set(
      (await repos.reviewLogs.since(raw.at + 1))
        .filter((l) => l.evidence === 'explicit' && l.correct)
        .map((l) => l.cardId),
    );
    return raw.cardIds.filter((id) => !fixed.has(id));
  }

  private async lastPracticeDayCards(now: number): Promise<string[]> {
    const repos = this.repos();
    if (!repos) return [];
    const todayStart = endOfPracticeDay(now, this.deps.day()) - DAY;
    const logs = (await repos.reviewLogs.latest(500)).filter(
      (l) =>
        l.evidence === 'explicit' && !l.cardId.startsWith(TOPIC_CARD_PREFIX) && l.ts < todayStart,
    );
    const last = logs[logs.length - 1];
    if (!last) return [];
    const day = dayKey(last.ts, this.deps.day());
    return logs.filter((l) => dayKey(l.ts, this.deps.day()) === day).map((l) => l.cardId);
  }

  async updateTask(
    date: string,
    taskId: string,
    patch: Partial<StoredTask>,
  ): Promise<DailyPlanRecord | null> {
    const repos = this.repos();
    const plan = await repos?.dailyPlans.get(date);
    if (!repos || !plan) return null;
    const next = {
      ...plan,
      tasks: plan.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
    };
    await repos.dailyPlans.put(next);
    return next;
  }

  /**
   * 通过掌握检查后，把今天任务里对应的新课标记为完成（从图谱进入课程时没有 taskId，也要同步）。
   */
  async completeLesson(topicId: string, taskId: string | undefined, xp: number, accuracy: number) {
    const repos = this.repos();
    if (!repos) return;
    const date = dayKey(this.deps.wallNow(), this.deps.day());
    const plan = await repos.dailyPlans.get(taskId ? (taskId.split(':')[0] as string) : date);
    const task = plan?.tasks.find((t) =>
      taskId
        ? t.id === taskId
        : t.kind === 'lesson' && t.topicIds[0] === topicId && t.status !== 'done',
    );
    if (!plan || !task) return;
    await this.updateTask(plan.date, task.id, {
      status: 'done',
      completedAt: this.deps.wallNow(),
      xp: Math.round(xp * 10) / 10,
      result: { passed: true, accuracy },
    });
  }

  /** "换一个"：把一节新课换成备选里的下一个（不与当天其他新课同一干扰组） */
  async replaceLesson(date: string, taskId: string): Promise<DailyPlanRecord | null> {
    const repos = this.repos();
    const plan = await repos?.dailyPlans.get(date);
    const task = plan?.tasks.find((t) => t.id === taskId);
    if (!repos || !plan || !task || task.kind !== 'lesson') return null;
    const graph = this.deps.pack.graph;
    const groups = new Set(
      plan.tasks
        .filter((t) => t.kind === 'lesson' && t.id !== taskId && t.status !== 'skipped')
        .map((t) => graph.byId.get(t.topicIds[0] as string)?.interferenceGroup)
        .filter((g) => g !== undefined),
    );
    const nextId = plan.spareLessons.find((id) => {
      const g = graph.byId.get(id)?.interferenceGroup;
      return !(g && groups.has(g));
    });
    const topic = nextId ? this.topic(nextId) : undefined;
    if (!nextId || !topic) return null;
    const old = task.topicIds[0] as string;
    const next: DailyPlanRecord = {
      ...plan,
      tasks: plan.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              topicIds: [nextId],
              cardIds: topic.cards.map((c) => c.id),
              minutes: topic.lesson.minutes,
            }
          : t,
      ),
      spareLessons: [...plan.spareLessons.filter((id) => id !== nextId), old],
    };
    await repos.dailyPlans.put(next);
    return next;
  }

  private topicLog(
    topicId: string,
    type: TopicLogType | 'implicit',
    over: Partial<ReviewLog>,
  ): ReviewLog {
    return {
      id: this.deps.uuid(),
      ts: this.deps.wallNow(),
      sessionId: null,
      cardId: topicCardId(topicId),
      cardKind: 'topic',
      drillType: type,
      evidence: 'explicit',
      weight: 1,
      correct: true,
      reactionMs: null,
      extraNotes: [],
      missingNotes: [],
      spreadMs: null,
      beatOffsetMs: null,
      hintUsed: false,
      rating: null,
      inputSource: 'manual',
      contentVersion: this.deps.pack.version,
      ...over,
    };
  }

  /** 开始课程（主题进入"学习中"）。已经开始过就不再写 */
  async recordLessonStart(topicId: string): Promise<void> {
    const snap = await this.snapshot();
    if (snap.topicProgress.get(topicId)?.lessonStartedAt != null) return;
    await this.repos()?.reviewLogs.append(this.topicLog(topicId, 'lesson', {}));
  }

  /** 某个主题在一轮练习里的成绩 */
  outcomeFor(topicId: string, result: SessionResult): TopicOutcome {
    const cardIds = new Set(this.topic(topicId)?.cards.map((c) => c.id) ?? []);
    const logs = result.logs.filter((l) => cardIds.has(l.cardId));
    const correct = logs.filter((l) => l.correct).length;
    const rating = topicRating(logs);
    return {
      topicId,
      total: logs.length,
      correct,
      accuracy: logs.length === 0 ? 0 : correct / logs.length,
      rating,
      // Hard 也算记住了（只是有点吃力）；Again 才算没通过，向上层传负信用
      passed: rating !== null && rating >= 2,
    };
  }

  /** 掌握检查的结果：通过时记为主题的第一次复习，并给包含的主题隐式信用 */
  async recordMastery(topicId: string, result: SessionResult): Promise<TopicOutcome> {
    const topic = this.topic(topicId);
    const outcome = this.outcomeFor(topicId, result);
    const passed =
      result.completed && masteryPassed(result.logs, topic?.lesson.mastery.minAccuracy ?? 0.85, 1);
    // 通过时按正确率评分（勉强通过记 Hard，复习来得更早），至少 Hard
    const rating: Rating | null = passed ? (Math.max(outcome.rating ?? 3, 2) as Rating) : null;
    const log = this.topicLog(topicId, 'mastery-check', {
      sessionId: result.sessionId,
      correct: passed,
      rating,
    });
    await this.appendWithImplicit(topicId, log, passed);
    if (passed) await this.inferPrerequisites(topicId);
    return { ...outcome, passed, rating };
  }

  /**
   * 跟拍主题的掌握检查（规格第 11 节过关标准）：弹完、没有漏弹、干净（对、在拍上、同时落下）的比例达标。
   * 干净率 ≥ 95% 记 Good，否则 Hard（复习来得更早）。
   */
  async recordRunMastery(topicId: string, result: RunResult): Promise<TopicOutcome> {
    const topic = this.topic(topicId);
    const minClean = topic?.lesson.mastery.minAccuracy ?? 0.85;
    const { summary } = result;
    const passed = result.completed && runPassed(summary, minClean);
    const rating: Rating | null = passed ? (summary.cleanRate >= 0.95 ? 3 : 2) : null;
    const log = this.topicLog(topicId, 'mastery-check', {
      sessionId: result.sessionId,
      correct: passed,
      rating,
    });
    await this.appendWithImplicit(topicId, log, passed);
    if (passed) await this.inferPrerequisites(topicId);
    return {
      topicId,
      total: summary.total,
      correct: Math.round(summary.cleanRate * summary.total),
      accuracy: summary.cleanRate,
      rating,
      passed,
    };
  }

  /**
   * 测验（规格 6.6）：每个主题按正确率评分（与复习一样记入主题记忆），
   * 答错的卡片记下来，下次编排成"针对性补救"任务。返回各主题结果与答错的卡片。
   */
  async recordQuiz(
    topicIds: readonly string[],
    result: SessionResult,
  ): Promise<{ outcomes: TopicOutcome[]; wrongCardIds: string[] }> {
    const outcomes: TopicOutcome[] = [];
    for (const id of topicIds) {
      const o = this.outcomeFor(id, result);
      outcomes.push(o);
      if (o.rating === null) continue;
      const log = this.topicLog(id, 'quiz', {
        sessionId: result.sessionId,
        correct: o.passed,
        rating: o.rating,
      });
      await this.appendWithImplicit(id, log, o.passed);
    }
    const wrongCardIds = [...new Set(result.logs.filter((l) => !l.correct).map((l) => l.cardId))];
    const remediation: Remediation = { at: this.deps.wallNow(), cardIds: wrongCardIds };
    await this.repos()?.settings.set(REMEDIATION_KEY, remediation);
    return { outcomes, wrongCardIds };
  }

  /**
   * 跳级（通过了后面主题的掌握检查，或诊断测试推断）：还没掌握的先修主题推断为已掌握，
   * 记 'diagnostic'，评分 Hard（复习来得早一些，如果其实没掌握很快就会暴露）。
   */
  async inferMastered(topicIds: readonly string[], rating: Rating = 2): Promise<string[]> {
    const repos = this.repos();
    if (!repos) return [];
    const snap = await this.snapshot();
    const fresh = topicIds.filter((id) => snap.topicProgress.get(id)?.masteredAt == null);
    for (const id of fresh) {
      await repos.reviewLogs.append(this.topicLog(id, 'diagnostic', { correct: true, rating }));
    }
    return fresh;
  }

  /** 通过某个主题的掌握检查后，它还没掌握的先修主题也推断为已掌握 */
  private async inferPrerequisites(topicId: string) {
    const graph = this.deps.pack.graph;
    const pre = allPrerequisites(graph, topicId);
    await this.inferMastered(graph.order.filter((id) => pre.has(id)));
  }

  /**
   * 诊断测试结束：直接通过的主题记 Good，推断的记 Hard；今天还没开始做任务时重新编排今天的任务
   * （起点变了）。返回新标记为已掌握的主题。
   */
  async recordDiagnostic(passed: readonly string[], known: readonly string[]): Promise<string[]> {
    const direct = await this.inferMastered(passed, 3);
    const inferred = await this.inferMastered(
      known.filter((id) => !passed.includes(id)),
      2,
    );
    const snap = await this.snapshot();
    const plan = await this.repos()?.dailyPlans.get(snap.date);
    if (!plan || plan.tasks.every((t) => t.status === 'pending')) await this.plan(true);
    return [...direct, ...inferred];
  }

  /** 每日复习任务：每个主题按正确率评分，并传递隐式信用（成功向下、失败向上） */
  async recordTopicReviews(
    topicIds: readonly string[],
    result: SessionResult,
  ): Promise<TopicOutcome[]> {
    const outcomes: TopicOutcome[] = [];
    for (const id of topicIds) {
      const o = this.outcomeFor(id, result);
      outcomes.push(o);
      if (o.rating === null) continue;
      const log = this.topicLog(id, 'topic-review', {
        sessionId: result.sessionId,
        correct: o.passed,
        rating: o.rating,
      });
      await this.appendWithImplicit(id, log, o.passed);
    }
    return outcomes;
  }

  private async appendWithImplicit(topicId: string, log: ReviewLog, passed: boolean) {
    const repos = this.repos();
    if (!repos) return;
    const snap = await this.snapshot();
    const progress = new Map(snap.topicProgress);
    progress.set(
      topicId,
      applyTopicLog(progress.get(topicId) ?? emptyTopicProgress(topicId), log, this.topicParams()),
    );
    const implicit = implicitCredits(this.deps.pack.graph, topicId, passed, progress).map((c) =>
      this.topicLog(c.topicId, 'implicit', {
        evidence: 'implicit',
        weight: c.weight,
        correct: c.positive,
        sessionId: log.sessionId,
        ts: log.ts,
      }),
    );
    await repos.reviewLogs.appendMany([log, ...implicit]);
  }

  /** 主题的卡片 */
  cards(topicId: string): AnyCard[] {
    return this.topic(topicId)?.cards ?? [];
  }

  /** 每日任务里的卡片 ID → 卡片 */
  cardsByIds(ids: readonly string[]): AnyCard[] {
    return ids.flatMap((id) => {
      const c = this.deps.pack.cardById.get(id);
      return c ? [c] : [];
    });
  }
}
