import { BUILTIN_PACK } from '@mayochord/content';
import { selectReviewCards } from '@mayochord/core';
import { Link, useNavigate } from '@tanstack/react-router';
import { Check, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/design/ui/button';
import { wallNow } from '@/lib/clock';
import { useDocumentTitle } from '@/lib/use-document-title';
import { cn } from '@/lib/utils';
import type { SessionResult } from '../practice/controller';
import { LoadingScreen, useEscapeToFinish } from '../practice/PracticeSessionPage';
import { practice, usePractice } from '../practice/practice';
import { CenteredMessage, SessionRunner } from '../practice/SessionRunner';
import { SessionSummaryView } from '../practice/SessionSummaryView';
import type { TopicOutcome } from './learning';
import { learning, refreshLearning, useLearning } from './service';
import { taskSpec } from './specs';

interface RunnableTask {
  /** 每日任务的 ID；临时复习（从图谱进入）没有 */
  id: string | null;
  kind: 'warmup' | 'review';
  topicIds: string[];
  cardIds: string[];
}

const topicTitle = (id: string) => BUILTIN_PACK.topicById.get(id)?.title['zh-CN'] ?? id;

/** 每日任务里的热身、复习 */
export function DailyTaskPage({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const plan = useLearning((s) => s.plan);
  useEffect(() => {
    if (!plan) void refreshLearning();
  }, [plan]);
  const task = plan?.tasks.find((x) => x.id === taskId);
  // 只在第一次读取时显示加载中；练习结束后的刷新不能卸载正在进行的练习
  if (!plan) return <LoadingScreen />;
  if (!task || task.kind === 'lesson') {
    return (
      <CenteredMessage>
        <p>{t('today.taskMissing')}</p>
        <Button asChild variant="outline">
          <Link to="/">{t('learn.backToToday')}</Link>
        </Button>
      </CenteredMessage>
    );
  }
  return (
    <TaskRunner
      task={{ id: task.id, kind: task.kind, topicIds: task.topicIds, cardIds: task.cardIds }}
    />
  );
}

/** 从图谱进入的临时复习：挑这个主题里最需要复习的卡片 */
export function TopicReviewPage({ topicId }: { topicId: string }) {
  const snapshot = useLearning((s) => s.snapshot);
  useEffect(() => {
    if (!snapshot) void refreshLearning();
  }, [snapshot]);
  const topic = BUILTIN_PACK.topicById.get(topicId);
  const task = useMemo<RunnableTask | null>(() => {
    if (!topic || !snapshot) return null;
    const cardIds = selectReviewCards(
      { id: topic.id, cardIds: topic.cards.map((c) => c.id), lessonMinutes: 0 },
      snapshot.cardProgress,
      wallNow() + 86_400_000,
      wallNow(),
      8,
    );
    return { id: null, kind: 'review', topicIds: [topic.id], cardIds };
  }, [topic, snapshot]);
  if (!task) return <LoadingScreen />;
  return <TaskRunner task={task} />;
}

function TaskRunner({ task: initialTask }: { task: RunnableTask }) {
  const { t } = useTranslation();
  // 只用第一次拿到的任务：结束后刷新"今天"的数据会生成新的任务对象，不能因此重新开始
  const [task] = useState(initialTask);
  useDocumentTitle(t(`today.kind.${task.kind}`));
  const navigate = useNavigate();
  const status = usePractice((v) => v.status);
  const [outcomes, setOutcomes] = useState<TopicOutcome[] | null>(null);
  const [completed, setCompleted] = useState(false);

  const start = useCallback(() => {
    setOutcomes(null);
    const cards = learning.cardsByIds(task.cardIds);
    void practice.start(taskSpec(task.kind, cards, { taskId: task.id, topicIds: task.topicIds }));
    const off = practice.onFinish((result: SessionResult) => {
      off();
      setCompleted(result.completed);
      if (!result.completed) return;
      void (async () => {
        const o =
          task.kind === 'review' ? await learning.recordTopicReviews(task.topicIds, result) : [];
        if (task.id) {
          await learning.updateTask(task.id.split(':')[0] as string, task.id, {
            status: 'done',
            completedAt: wallNow(),
            xp: Math.round(result.xp * 10) / 10,
            result: { accuracy: result.summary.accuracy },
          });
        }
        await refreshLearning();
        setOutcomes(o);
      })();
    });
  }, [task]);

  // start 只依赖固定的 task，所以只在挂载时执行一次
  useEffect(() => {
    start();
    return () => practice.dispose();
  }, [start]);

  useEscapeToFinish(useCallback(() => void navigate({ to: '/' }), [navigate]));

  if (status === 'summary') {
    return (
      <SessionSummaryView
        onAgain={start}
        againLabel={completed ? undefined : t('today.continueTask')}
        backTo="/"
        backLabel={t('learn.backToToday')}
      >
        {outcomes && outcomes.length > 0 && <TopicOutcomes outcomes={outcomes} />}
      </SessionSummaryView>
    );
  }
  if (status === 'empty') {
    return (
      <CenteredMessage>
        <p>{t('practice.empty')}</p>
        <Button asChild variant="outline">
          <Link to="/">{t('learn.backToToday')}</Link>
        </Button>
      </CenteredMessage>
    );
  }
  if (status !== 'running') return <LoadingScreen />;
  return (
    <SessionRunner
      title={`${t(`today.kind.${task.kind}`)}${task.topicIds.length > 0 ? ` · ${task.topicIds.map(topicTitle).join('、')}` : ''}`}
    />
  );
}

/** 复习后每个主题的结果 */
function TopicOutcomes({ outcomes }: { outcomes: TopicOutcome[] }) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-2" aria-label={t('today.topicResults')}>
      {outcomes.map((o) => (
        <li
          key={o.topicId}
          className={cn(
            'flex items-center gap-3 rounded-lg border px-4 py-3',
            o.passed ? 'border-mark-correct/40' : 'border-warning/40',
          )}
        >
          {o.passed ? (
            <Check className="size-5 text-mark-correct" aria-hidden />
          ) : (
            <TriangleAlert className="size-5 text-warning" aria-hidden />
          )}
          <span className="font-medium">{topicTitle(o.topicId)}</span>
          <span className="ml-auto font-mono text-sm text-muted-foreground tabular-nums">
            {o.correct}/{o.total}
          </span>
          <span className={cn('text-sm', o.passed ? 'text-mark-correct' : 'text-warning')}>
            {o.rating === 2
              ? t('today.reviewHard')
              : o.passed
                ? t('today.reviewPassed')
                : t('today.reviewFailed')}
          </span>
        </li>
      ))}
    </ul>
  );
}
