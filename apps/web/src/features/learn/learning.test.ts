import 'fake-indexeddb/auto';
import { BUILTIN_PACK } from '@mayochord/content';
import { type ReviewLog, type SessionSummary, summarizeRun } from '@mayochord/core';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MayoChordDB } from '@/storage/db';
import { createDexieRepositories, type Repositories } from '@/storage/repositories';
import type { SessionResult, SessionSpec } from '../practice/controller';
import type { RunResult } from '../progression/run-controller';
import { LearningService } from './learning';
import { guidedSpec, independentSpec, masterySpec, spread, taskSpec } from './specs';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 14, 4); // 东八区 12:00
let now = T0;
let db: MayoChordDB;
let repos: Repositories;
let ids = 0;

const service = (params = {}) =>
  new LearningService({
    pack: BUILTIN_PACK,
    repos: () => repos,
    wallNow: () => now,
    uuid: () => `u${ids++}`,
    day: () => ({ dayStartHour: 4, tzOffsetMinutes: -480 }),
    planParams: () => params,
  });

const SUMMARY: SessionSummary = {
  total: 0,
  correct: 0,
  accuracy: 0,
  timedOut: 0,
  hintsUsed: 0,
  meanReactionMs: null,
  slowestChord: null,
  slowestTransition: null,
  meanSpreadMs: null,
  notTogether: 0,
  bestStreak: 0,
};

/** 一轮练习的结果：cardIds 里每张卡一题，correct 决定对错 */
function result(
  cardIds: string[],
  correct: (i: number) => boolean,
  completed = true,
): SessionResult {
  const logs: ReviewLog[] = cardIds.map((cardId, i) => ({
    id: `l${ids++}`,
    ts: now,
    sessionId: 's',
    cardId,
    cardKind: 'note',
    drillType: 'name-to-note',
    evidence: 'explicit',
    weight: 1,
    correct: correct(i),
    reactionMs: 800,
    extraNotes: [],
    missingNotes: [],
    spreadMs: 10,
    beatOffsetMs: null,
    hintUsed: false,
    rating: correct(i) ? 3 : 1,
    inputSource: 'midi',
    contentVersion: '1',
  }));
  return {
    spec: {} as SessionSpec,
    sessionId: 's',
    evidence: [],
    logs,
    summary: SUMMARY,
    xp: 1,
    completed,
  };
}

const keyboardCards = (BUILTIN_PACK.topicById.get('keyboard-names')?.cards ?? []).map((c) => c.id);

beforeEach(() => {
  now = T0;
  db = new MayoChordDB(`learn-${Date.now()}-${Math.random()}`);
  repos = createDexieRepositories(db);
});
afterEach(async () => {
  db.close();
  await Dexie.delete(db.name);
});

describe('LearningService', () => {
  it('第一天：第一节课；同一天再打开读取已保存的任务', async () => {
    const s = service();
    const { plan, snapshot } = await s.plan();
    expect(plan.date).toBe('2026-10-14');
    expect(plan.tasks.map((t) => [t.kind, t.topicIds, t.status])).toEqual([
      ['lesson', ['keyboard-names'], 'pending'],
    ]);
    expect(snapshot.statuses.get('keyboard-names')).toBe('available');
    expect(snapshot.statuses.get('half-whole-steps')).toBe('locked');
    await s.updateTask(plan.date, plan.tasks[0]?.id as string, { status: 'skipped' });
    const again = await s.plan();
    expect(again.plan.tasks[0]?.status).toBe('skipped');
    // 开发用：重新编排
    expect((await s.plan(true)).plan.tasks[0]?.status).toBe('pending');
  });

  it('开始课程 → 学习中；掌握检查通过 → 已掌握，解锁下一个主题，任务同步完成', async () => {
    const s = service();
    await s.plan();
    await s.recordLessonStart('keyboard-names');
    await s.recordLessonStart('keyboard-names');
    expect((await repos.reviewLogs.byCardPrefix('topic:')).length).toBe(1);
    expect((await s.snapshot()).statuses.get('keyboard-names')).toBe('learning');

    // 没做完的检查不算通过
    const partial = await s.recordMastery(
      'keyboard-names',
      result(keyboardCards, () => true, false),
    );
    expect(partial.passed).toBe(false);
    // 正确率 11/12 ≥ 90%
    const outcome = await s.recordMastery(
      'keyboard-names',
      result(keyboardCards, (i) => i !== 0),
    );
    expect(outcome).toMatchObject({ passed: true, total: 12, correct: 11 });
    const snap = await s.snapshot();
    expect(snap.statuses.get('keyboard-names')).toBe('mastered');
    expect(snap.statuses.get('half-whole-steps')).toBe('available');

    // 从图谱进入的课程（没有 taskId）也把今天的同名任务标记完成
    await s.completeLesson('keyboard-names', undefined, 2.5, 0.9);
    const after = await s.plan();
    expect(after.plan.tasks[0]).toMatchObject({ status: 'done', xp: 2.5 });
  });

  it('已通过的课：读取今天的任务时自动标记完成', async () => {
    const s = service();
    await s.plan();
    await s.recordMastery(
      'keyboard-names',
      result(keyboardCards, () => true),
    );
    const { plan } = await s.plan();
    expect(plan.tasks[0]?.status).toBe('done');
  });

  it('复习：按正确率评分；成功给被包含的主题隐式信用，失败给上层负信用', async () => {
    const s = service();
    for (const id of ['keyboard-names', 'half-whole-steps', 'thirds']) {
      await s.recordMastery(
        id,
        result(keyboardCards, () => true),
      );
    }
    now = T0 + 5 * DAY;
    // thirds 包含 half-whole-steps（0.5），half-whole-steps 包含 keyboard-names（0.3）
    const thirdsCards = (BUILTIN_PACK.topicById.get('thirds')?.cards ?? []).map((c) => c.id);
    const [ok] = await s.recordTopicReviews(
      ['thirds'],
      result(thirdsCards, () => true),
    );
    expect(ok).toMatchObject({ passed: true, rating: 3 });
    // 掌握检查通过时也会给包含的主题信用；这里只看复习产生的
    const implicit = (await repos.reviewLogs.byCardPrefix('topic:')).filter(
      (l) => l.evidence === 'implicit' && l.ts === now,
    );
    expect(implicit.map((l) => [l.cardId, l.weight, l.correct])).toEqual([
      ['topic:keyboard-names', 0.15, true],
      ['topic:half-whole-steps', 0.5, true],
    ]);

    // 失败：向上传负信用（half-whole-steps 被 thirds 包含）
    const hwCards = (BUILTIN_PACK.topicById.get('half-whole-steps')?.cards ?? []).map((c) => c.id);
    const [bad] = await s.recordTopicReviews(
      ['half-whole-steps'],
      result(hwCards, (i) => i < 2),
    );
    expect(bad).toMatchObject({ passed: false, rating: 1 });
    const negative = (await repos.reviewLogs.byCardPrefix('topic:')).filter(
      (l) => l.evidence === 'implicit' && !l.correct,
    );
    expect(negative.map((l) => l.cardId)).toEqual(['topic:thirds']);
    // 没有这个主题卡片的成绩：不写主题日志
    expect(
      await s.recordTopicReviews(
        ['marusa'],
        result(hwCards, () => true),
      ),
    ).toEqual([expect.objectContaining({ topicId: 'marusa', rating: null, passed: false })]);
  });

  it('到期复习与热身进入每日任务；换一个新课', async () => {
    const s = service({ newPerDay: 2, minutes: 60 });
    for (const id of ['keyboard-names', 'half-whole-steps', 'thirds']) {
      await s.recordMastery(
        id,
        result(keyboardCards, () => true),
      );
    }
    await repos.reviewLogs.appendMany(result(keyboardCards.slice(0, 3), () => true).logs);
    now = T0 + 20 * DAY;
    const { plan } = await s.plan();
    const kinds = plan.tasks.map((t) => t.kind);
    expect(kinds[0]).toBe('warmup');
    expect(plan.tasks[0]?.cardIds).toEqual(keyboardCards.slice(0, 3));
    expect(kinds).toContain('review');
    expect(plan.dueTopics.length).toBeGreaterThan(0);
    // 大三、小三和弦公式同属一个干扰组：只排一个，另一个在备选里
    const lessons = plan.tasks.filter((t) => t.kind === 'lesson').map((t) => t.topicIds[0]);
    // 认识键盘之后，三和弦公式与认识五线谱（M10）都解锁了；每天最多两节
    expect(lessons).toEqual(['major-triad-formula', 'staff-basics']);
    expect(plan.spareLessons).toContain('minor-triad-formula');
    const lessonTask = plan.tasks.find((t) => t.kind === 'lesson');
    const replaced = await s.replaceLesson(plan.date, lessonTask?.id as string);
    expect(replaced?.tasks.find((t) => t.id === lessonTask?.id)?.topicIds).toEqual([
      'minor-triad-formula',
    ]);
    expect(replaced?.spareLessons).toContain('major-triad-formula');
    expect(await s.replaceLesson(plan.date, 'nope')).toBeNull();
  });

  it('跟拍主题的掌握检查：没有漏弹、干净率达标才通过；≥95% 记 Good', async () => {
    const s = service();
    const run = (cleanRate: number, missed: number, completed = true) =>
      ({
        config: {} as never,
        sessionId: 's',
        results: [],
        logs: [],
        xp: 1,
        completed,
        summary: { ...summarizeRun([]), total: 16, cleanRate, missed },
      }) as RunResult;
    expect(await s.recordRunMastery('steady-c-g-am-f', run(0.9, 1))).toMatchObject({
      passed: false,
      rating: null,
    });
    expect(await s.recordRunMastery('steady-c-g-am-f', run(0.9, 0, false))).toMatchObject({
      passed: false,
    });
    expect(await s.recordRunMastery('steady-c-g-am-f', run(0.875, 0))).toMatchObject({
      passed: true,
      rating: 2,
      total: 16,
      correct: 14,
    });
    expect(await s.recordRunMastery('marusa-tempo', run(1, 0))).toMatchObject({ rating: 3 });
    const snap = await s.snapshot();
    expect(snap.statuses.get('steady-c-g-am-f')).toBe('mastered');
  });

  it('测验：按主题记成绩，答错的卡片进入针对性补救，之后答对就移出', async () => {
    const s = service();
    const hw = (BUILTIN_PACK.topicById.get('half-whole-steps')?.cards ?? []).map((c) => c.id);
    const quiz = result(
      [...keyboardCards.slice(0, 2), ...hw.slice(0, 2)],
      (i) => i !== 1 && i !== 3,
    );
    const { outcomes, wrongCardIds } = await s.recordQuiz(
      ['keyboard-names', 'half-whole-steps'],
      quiz,
    );
    expect(outcomes.map((o) => [o.topicId, o.correct, o.total])).toEqual([
      ['keyboard-names', 1, 2],
      ['half-whole-steps', 1, 2],
    ]);
    expect(wrongCardIds).toEqual([keyboardCards[1], hw[1]]);
    expect((await s.snapshot()).lastQuizAt).toBe(now);
    expect(await s.remediationCards()).toEqual(wrongCardIds);
    now += 1000;
    await repos.reviewLogs.appendMany(result([keyboardCards[1] as string], () => true).logs);
    expect(await s.remediationCards()).toEqual([hw[1]]);
  });

  it('跳级：通过后面主题的掌握检查，没掌握的先修推断为已掌握', async () => {
    const s = service();
    const thirds = (BUILTIN_PACK.topicById.get('thirds')?.cards ?? []).map((c) => c.id);
    await s.recordMastery(
      'thirds',
      result(thirds, () => true),
    );
    const snap = await s.snapshot();
    expect(snap.statuses.get('keyboard-names')).toBe('mastered');
    expect(snap.statuses.get('half-whole-steps')).toBe('mastered');
    const logs = await repos.reviewLogs.byCardPrefix('topic:');
    expect(
      logs.filter((l) => l.drillType === 'diagnostic').map((l) => [l.cardId, l.rating]),
    ).toEqual([
      ['topic:keyboard-names', 2],
      ['topic:half-whole-steps', 2],
    ]);
  });

  it('诊断测试：直接通过的记 Good、推断的记 Hard；今天还没开始就重新编排', async () => {
    const s = service();
    const before = await s.plan();
    expect(before.plan.tasks[0]?.topicIds).toEqual(['keyboard-names']);
    const mastered = await s.recordDiagnostic(
      ['thirds'],
      ['keyboard-names', 'half-whole-steps', 'thirds'],
    );
    expect(mastered).toEqual(['thirds', 'keyboard-names', 'half-whole-steps']);
    const after = await s.plan();
    const lessons = after.plan.tasks.filter((t) => t.kind === 'lesson').flatMap((t) => t.topicIds);
    expect(lessons).not.toContain('keyboard-names');
    expect(lessons[0]).toBe('major-triad-formula');
    // 最近掌握了 3 个主题：顺便排了一次测验
    expect(after.plan.tasks.map((t) => t.kind)).toContain('quiz');
    const ratings = (await repos.reviewLogs.byCardPrefix('topic:')).map((l) => [
      l.cardId,
      l.rating,
    ]);
    expect(ratings).toContainEqual(['topic:thirds', 3]);
    // 再次推断已经掌握的主题：不重复写
    expect(await s.inferMastered(['thirds'])).toEqual([]);
  });

  it('存储不可用时返回空进度', async () => {
    const s = new LearningService({
      pack: BUILTIN_PACK,
      repos: () => null,
      wallNow: () => now,
      uuid: () => 'x',
      day: () => ({ dayStartHour: 4, tzOffsetMinutes: -480 }),
      planParams: () => ({}),
    });
    const { plan } = await s.plan();
    expect(plan.tasks).toHaveLength(1);
    expect(await s.updateTask(plan.date, 'x', {})).toBeNull();
    expect(s.cardsByIds(['note:c', 'missing']).map((c) => c.id)).toEqual(['note:c']);
    expect(s.cards('thirds')).toHaveLength(8);
  });
});

describe('课程与任务的练习规格', () => {
  const topic = BUILTIN_PACK.topicById.get('triads-12-keys');
  if (!topic) throw new Error('topic');

  it('spread：均匀挑选', () => {
    expect(spread([1, 2, 3, 4, 5, 6, 7, 8], 4)).toEqual([1, 3, 5, 7]);
    expect(spread([1, 2], 4)).toEqual([1, 2]);
  });

  it('引导、独立、掌握检查、复习', () => {
    const g = guidedSpec(topic);
    expect(g).toMatchObject({ kind: 'guided', order: 'sequential', hints: 'always', length: 6 });
    expect(g.cards.map((c) => c.id)).toContain('chord:cm:name:any');
    expect(independentSpec(topic)).toMatchObject({ targetCorrect: 12, length: 36, hints: 'auto' });
    expect(masterySpec(topic)).toMatchObject({
      hints: 'never',
      length: 12,
      fixedTimeLimitMs: 6000,
      retryWrong: false,
      requireCorrection: false,
    });
    expect(taskSpec('review', topic.cards.slice(0, 5), {})).toMatchObject({
      length: 8,
      order: 'mixed',
    });
    expect(taskSpec('warmup', topic.cards.slice(0, 5), {})).toMatchObject({ length: 5 });
  });
});
