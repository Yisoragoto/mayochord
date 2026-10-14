import { describe, expect, it } from 'vitest';
import type { ReviewLog } from '../log/review-log';
import { endOfPracticeDay, planDay, type TopicPlanInfo } from '../scheduler/daily';
import { implicitCredits } from '../scheduler/implicit';
import { emptyProgress } from '../scheduler/progress';
import { layoutTopicGraph, topicRanks } from './layout';
import {
  allPrerequisites,
  buildTopicGraph,
  encompassedWeights,
  encompassingWeights,
  type TopicNode,
  validateTopicGraph,
} from './topic-graph';
import {
  applyTopicLog,
  emptyTopicProgress,
  replayTopicProgress,
  type TopicProgress,
  topicCardId,
  topicStatus,
  topicStatuses,
} from './topic-progress';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 14, 4); // 东八区 12:00
const dayParams = { dayStartHour: 4, tzOffsetMinutes: -480 };
const tparams = {
  fsrs: { requestRetention: 0.9, maximumInterval: 365, enableFuzz: false },
  day: dayParams,
  minEarlyFactor: 0.1,
};

const node = (
  id: string,
  prerequisites: string[] = [],
  encompasses: [string, number][] = [],
  interferenceGroup?: string,
): TopicNode => {
  const n: TopicNode = {
    id,
    prerequisites,
    encompasses: encompasses.map(([topicId, weight]) => ({ topicId, weight })),
  };
  if (interferenceGroup) n.interferenceGroup = interferenceGroup;
  return n;
};

// keys → steps → thirds → {major, minor} → c-triads → prog
const NODES = [
  node('keys'),
  node('steps', ['keys'], [['keys', 0.5]]),
  node('thirds', ['steps'], [['steps', 0.6]]),
  node('major', ['thirds'], [['thirds', 0.5]], 'triad'),
  node('minor', ['thirds'], [['thirds', 0.5]], 'triad'),
  node(
    'c-triads',
    ['major', 'minor'],
    [
      ['major', 0.5],
      ['minor', 0.5],
    ],
  ),
  node('prog', ['c-triads'], [['c-triads', 0.8]]),
];
const graph = buildTopicGraph(NODES);

let seq = 0;
const tlog = (topicId: string, over: Partial<ReviewLog>): ReviewLog => ({
  id: `t${seq++}`,
  ts: T0,
  sessionId: null,
  cardId: topicCardId(topicId),
  cardKind: 'topic',
  drillType: 'topic-review',
  evidence: 'explicit',
  weight: 1,
  correct: true,
  reactionMs: null,
  extraNotes: [],
  missingNotes: [],
  spreadMs: null,
  beatOffsetMs: null,
  hintUsed: false,
  rating: 3,
  inputSource: 'manual',
  contentVersion: '1',
  ...over,
});

const mastered = (id: string, ts = T0): TopicProgress =>
  replayTopicProgress(id, [tlog(id, { drillType: 'mastery-check', ts })], tparams);

describe('图谱结构', () => {
  it('校验：重复、引用不存在、自环、权重、环', () => {
    expect(validateTopicGraph(NODES)).toEqual([]);
    expect(validateTopicGraph([node('a'), node('a')])).toContain('重复的主题 ID：a');
    expect(validateTopicGraph([node('a', ['x'])])).toContain('a 的先修主题不存在：x');
    expect(validateTopicGraph([node('a', ['a'])])).toContain('a 不能以自己为先修');
    expect(validateTopicGraph([node('a', [], [['a', 0.5]])])).toContain('a 不能包含自己');
    expect(validateTopicGraph([node('a', [], [['x', 0.5]])])).toContain('a 包含的主题不存在：x');
    expect(validateTopicGraph([node('a'), node('b', [], [['a', 1.5]])])).toContain(
      'b → a 的权重应在 0–1',
    );
    expect(validateTopicGraph([node('a', ['b']), node('b', ['a'])])).toEqual(['先修关系有环']);
    expect(() => buildTopicGraph([node('a', ['b']), node('b', ['a'])])).toThrow('有环');
  });

  it('拓扑顺序、依赖、所有先修', () => {
    expect(graph.order).toEqual(['keys', 'steps', 'thirds', 'major', 'minor', 'c-triads', 'prog']);
    expect(graph.dependents.get('thirds')).toEqual(['major', 'minor']);
    expect([...allPrerequisites(graph, 'c-triads')].sort()).toEqual(
      ['keys', 'major', 'minor', 'steps', 'thirds'].sort(),
    );
  });

  it('包含权重沿路径相乘、逐级衰减，取最大路径', () => {
    const down = encompassedWeights(graph, 'prog');
    expect(down.get('c-triads')).toBe(0.8);
    expect(down.get('major')).toBeCloseTo(0.4);
    expect(down.get('thirds')).toBeCloseTo(0.2);
    expect(down.get('steps')).toBeCloseTo(0.12);
    expect(down.get('keys')).toBeCloseTo(0.06);
    expect(encompassedWeights(graph, 'prog', 0.1).has('keys')).toBe(false);
    const up = encompassingWeights(graph, 'thirds');
    expect(up.get('major')).toBe(0.5);
    expect(up.get('c-triads')).toBeCloseTo(0.25);
    expect(up.get('prog')).toBeCloseTo(0.2);
  });
});

describe('分层布局', () => {
  it('层 = 最长先修链；同层居中；LR 与 TB', () => {
    const ranks = topicRanks(graph);
    expect(ranks.get('keys')).toBe(0);
    expect(ranks.get('major')).toBe(3);
    expect(ranks.get('prog')).toBe(5);
    const opts = { nodeWidth: 100, nodeHeight: 40, rankGap: 50, nodeGap: 10 };
    const lr = layoutTopicGraph(graph, { ...opts, orientation: 'LR' });
    expect(lr.width).toBe(6 * 100 + 5 * 50);
    expect(lr.height).toBe(2 * 40 + 10);
    expect(lr.nodes.get('keys')).toMatchObject({ x: 0, y: 25, rank: 0 });
    expect(lr.nodes.get('major')?.x).toBe(450);
    expect(lr.edges).toHaveLength(7);
    expect(lr.edges.find((e) => e.from === 'keys')).toMatchObject({ x1: 100, y1: 45, x2: 150 });
    const tb = layoutTopicGraph(graph, { ...opts, orientation: 'TB' });
    expect(tb.width).toBe(2 * 100 + 10);
    expect(tb.nodes.get('prog')).toMatchObject({ y: 5 * 90 });
    expect(tb.edges.find((e) => e.to === 'prog')).toMatchObject({ y2: 450 });
  });

  it('重心法：交叉的连线被理顺', () => {
    const g = buildTopicGraph([node('a'), node('b'), node('x', ['b']), node('y', ['a'])]);
    const l = layoutTopicGraph(g, {
      orientation: 'LR',
      nodeWidth: 10,
      nodeHeight: 10,
      rankGap: 10,
      nodeGap: 10,
    });
    expect(l.nodes.get('y')?.order).toBe(l.nodes.get('a')?.order);
    expect(l.nodes.get('x')?.order).toBe(l.nodes.get('b')?.order);
  });
});

describe('主题进度与状态', () => {
  it('课程开始 → 学习中；掌握检查通过 → 已掌握，并有 FSRS 记忆', () => {
    let p = emptyTopicProgress('keys');
    p = applyTopicLog(p, tlog('keys', { drillType: 'lesson', rating: null }), tparams);
    expect(p.lessonStartedAt).toBe(T0);
    p = applyTopicLog(p, tlog('keys', { drillType: 'lesson', rating: null, ts: T0 + 5 }), tparams);
    expect(p.lessonStartedAt).toBe(T0);
    // 掌握检查没通过：不记复习
    p = applyTopicLog(
      p,
      tlog('keys', { drillType: 'mastery-check', correct: false, rating: null }),
      tparams,
    );
    expect(p.masteredAt).toBeNull();
    p = applyTopicLog(p, tlog('keys', { drillType: 'mastery-check', ts: T0 + 10 }), tparams);
    expect(p).toMatchObject({ masteredAt: T0 + 10, confirmedAt: null });
    expect(p.memory?.state).toBe('review');
    // 其他主题的日志、未知类型忽略
    expect(applyTopicLog(p, tlog('steps', {}), tparams)).toBe(p);
    expect(applyTopicLog(p, tlog('keys', { drillType: 'other' }), tparams)).toBe(p);
    expect(applyTopicLog(p, tlog('keys', { rating: null }), tparams)).toBe(p);
  });

  it('掌握后隔天复习通过 → confirmedAt；同一天不算', () => {
    let p = mastered('keys');
    p = applyTopicLog(p, tlog('keys', { ts: T0 + 3600_000 }), tparams);
    expect(p.confirmedAt).toBeNull();
    p = applyTopicLog(p, tlog('keys', { ts: T0 + DAY }), tparams);
    expect(p.confirmedAt).toBe(T0 + DAY);
  });

  it('状态：未解锁、可学习、学习中、已掌握、需复习', () => {
    const progress = new Map<string, TopicProgress>([['keys', mastered('keys')]]);
    expect(topicStatus(graph, progress, 'keys', T0 + 1)).toBe('mastered');
    expect(topicStatus(graph, progress, 'keys', T0 + 365 * DAY)).toBe('review');
    expect(topicStatus(graph, progress, 'steps', T0)).toBe('available');
    expect(topicStatus(graph, progress, 'thirds', T0)).toBe('locked');
    progress.set('steps', { ...emptyTopicProgress('steps'), lessonStartedAt: T0 });
    expect(topicStatus(graph, progress, 'steps', T0)).toBe('learning');
    // 两个先修都要掌握
    progress.set('major', mastered('major'));
    expect(topicStatus(graph, progress, 'c-triads', T0)).toBe('locked');
    progress.set('minor', mastered('minor'));
    expect(topicStatuses(graph, progress, T0).get('c-triads')).toBe('available');
  });

  it('隐式信用：满 1 记一次复习；过早打折扣；未掌握的主题不接收', () => {
    const base = mastered('thirds');
    const interval = base.memory?.scheduledDays as number;
    // 刚复习完就来信用：按 0.1 折扣
    let p = applyTopicLog(
      base,
      tlog('thirds', { evidence: 'implicit', weight: 0.5, ts: T0 + 1 }),
      tparams,
    );
    expect(p.credit).toBeCloseTo(0.05);
    // 到了间隔：不打折，累积满 1 后记一次 Good
    const late = T0 + interval * DAY;
    p = applyTopicLog(p, tlog('thirds', { evidence: 'implicit', weight: 0.5, ts: late }), tparams);
    expect(p.credit).toBeCloseTo(0.55);
    p = applyTopicLog(
      p,
      tlog('thirds', { evidence: 'implicit', weight: 0.5, ts: late + 1 }),
      tparams,
    );
    expect(p.credit).toBeCloseTo(0.05);
    expect(p.memory?.reps).toBe(2);
    expect(p.memory?.due).toBeGreaterThan(base.memory?.due as number);
    // 负信用满 1 记一次 Hard
    let q = applyTopicLog(
      base,
      tlog('thirds', { evidence: 'implicit', correct: false, weight: 0.6, ts: late }),
      tparams,
    );
    expect(q.penalty).toBeCloseTo(0.6);
    q = applyTopicLog(
      q,
      tlog('thirds', { evidence: 'implicit', correct: false, weight: 0.6, ts: late }),
      tparams,
    );
    expect(q.penalty).toBeCloseTo(0.2);
    expect(q.memory?.reps).toBe(2);
    // 未掌握
    const fresh = emptyTopicProgress('thirds');
    expect(applyTopicLog(fresh, tlog('thirds', { evidence: 'implicit', weight: 1 }), tparams)).toBe(
      fresh,
    );
  });

  it('implicitCredits：成功向下、失败向上，只给已掌握的主题', () => {
    const progress = new Map<string, TopicProgress>(
      ['keys', 'steps', 'thirds', 'major', 'c-triads'].map((id) => [id, mastered(id)]),
    );
    expect(implicitCredits(graph, 'prog', true, progress)).toEqual([
      { topicId: 'keys', weight: 0.06, positive: true },
      { topicId: 'steps', weight: 0.12, positive: true },
      { topicId: 'thirds', weight: 0.2, positive: true },
      { topicId: 'major', weight: 0.4, positive: true },
      { topicId: 'c-triads', weight: 0.8, positive: true },
    ]);
    expect(implicitCredits(graph, 'thirds', false, progress)).toEqual([
      { topicId: 'major', weight: 0.5, positive: false },
      { topicId: 'c-triads', weight: 0.25, positive: false },
    ]);
  });
});

describe('每日任务编排', () => {
  const info = (id: string, n = 4, lessonMinutes = 8): TopicPlanInfo => ({
    id,
    cardIds: Array.from({ length: n }, (_, i) => `${id}:card${i}`),
    lessonMinutes,
  });
  const topics = new Map(NODES.map((n) => [n.id, info(n.id)]));
  const base = {
    now: T0,
    day: dayParams,
    graph,
    topics,
    cardProgress: new Map(),
    recentCardIds: [],
  };

  it('第一天：没有热身和复习，按图谱顺序安排第一节课', () => {
    const plan = planDay({ ...base, topicProgress: new Map() });
    expect(plan.date).toBe('2026-10-14');
    expect(plan.tasks.map((t) => [t.kind, t.topicIds])).toEqual([['lesson', ['keys']]]);
    expect(plan.tasks[0]?.id).toBe('2026-10-14:lesson:1');
    expect(plan.dueTopics).toEqual([]);
  });

  it('同一干扰组的新课不在同一天；每天新课有上限；先继续学习中的课', () => {
    const progress = new Map<string, TopicProgress>(
      ['keys', 'steps', 'thirds'].map((id) => [id, mastered(id, T0 - 30 * DAY)]),
    );
    // 让复习都不到期
    for (const [id, p] of progress) {
      progress.set(id, {
        ...p,
        memory: { ...(p.memory as NonNullable<TopicProgress['memory']>), due: T0 + 30 * DAY },
      });
    }
    let plan = planDay({ ...base, topicProgress: progress });
    expect(plan.tasks.map((t) => t.topicIds[0])).toEqual(['major']);
    expect(plan.spareLessons).toEqual(['minor']);
    progress.set('minor', { ...emptyTopicProgress('minor'), lessonStartedAt: T0 - DAY });
    plan = planDay({ ...base, topicProgress: progress });
    expect(plan.tasks.map((t) => t.topicIds[0])).toEqual(['minor']);
    plan = planDay({ ...base, topicProgress: progress, params: { newPerDay: 1 } });
    expect(plan.tasks).toHaveLength(1);
  });

  it('热身 + 到期复习（优先覆盖更多到期主题）+ 时长限制', () => {
    const progress = new Map<string, TopicProgress>(
      ['keys', 'steps', 'thirds', 'major', 'minor', 'c-triads'].map((id) => [
        id,
        mastered(id, T0 - 60 * DAY),
      ]),
    );
    const plan = planDay({
      ...base,
      topicProgress: progress,
      recentCardIds: ['keys:card0', 'unknown', 'keys:card1', 'keys:card0'],
      cardProgress: new Map([
        [
          'c-triads:card3',
          {
            ...emptyProgress('c-triads:card3'),
            memory: {
              ...(mastered('x').memory as NonNullable<TopicProgress['memory']>),
              due: T0 - DAY,
            },
          },
        ],
      ]),
      params: { minutes: 20 },
    });
    const kinds = plan.tasks.map((t) => t.kind);
    expect(kinds[0]).toBe('warmup');
    expect(plan.tasks[0]?.cardIds).toEqual(['keys:card0', 'keys:card1']);
    expect(plan.dueTopics).toHaveLength(6);
    // c-triads 覆盖 major、minor（权重 0.5）；steps 覆盖 keys（0.5）
    const reviews = plan.tasks.filter((t) => t.kind === 'review');
    const reviewed = reviews.flatMap((t) => t.topicIds);
    expect(reviewed).toContain('c-triads');
    expect(reviewed).not.toContain('major');
    expect(reviews.flatMap((t) => t.covers).sort()).toEqual(['keys', 'major', 'minor']);
    // 到期的卡片排在前面，且不同主题交错
    const first = reviews.find((t) => t.topicIds.includes('c-triads'));
    const cIdx = first?.cardIds.filter((c) => c.startsWith('c-triads'));
    expect(cIdx?.[0]).toBe('c-triads:card3');
    expect(first?.cardIds[0]?.split(':')[0]).not.toBe(first?.cardIds[1]?.split(':')[0]);
    // 热身 3 + 复习 3（12 题 × 15 秒）+ 新课 prog 8 = 14 分钟，在 20 分钟预算内
    expect(plan.tasks.map((t) => [t.kind, t.minutes])).toEqual([
      ['warmup', 3],
      ['review', 3],
      ['lesson', 8],
    ]);
    const tight = planDay({ ...base, topicProgress: progress, params: { minutes: 3 } });
    expect(tight.tasks.some((t) => t.kind === 'lesson')).toBe(false);
    expect(tight.spareLessons).toEqual(['prog']);
  });

  it('endOfPracticeDay：东八区次日凌晨 4 点', () => {
    expect(new Date(endOfPracticeDay(T0, dayParams)).toISOString()).toBe(
      '2026-10-14T20:00:00.000Z',
    );
  });
});
