import { BUILTIN_PACK } from '@mayochord/content';
import { type IntervalName, selectReviewCards } from '@mayochord/core';
import { Link, useNavigate } from '@tanstack/react-router';
import { Check, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/design/ui/button';
import { wallNow } from '@/lib/clock';
import { listSep, localize } from '@/lib/localize';
import { useDocumentTitle } from '@/lib/use-document-title';
import { cn } from '@/lib/utils';
import { cardLabel } from '../practice/cards-view';
import type { SessionResult } from '../practice/controller';
import { LoadingScreen, useEscapeToFinish } from '../practice/PracticeSessionPage';
import { practice, usePractice } from '../practice/practice';
import { CenteredMessage, SessionRunner } from '../practice/SessionRunner';
import { SessionSummaryView } from '../practice/SessionSummaryView';
import { RhythmRunner } from '../reading/RhythmRunner';
import { rhythmSession, useRhythmSession } from '../reading/rhythm';
import type { TopicOutcome } from './learning';
import { learning, refreshLearning, useLearning } from './service';
import { taskSpec } from './specs';

interface RunnableTask {
  /** 每日任务的 ID；临时复习（从图谱进入）没有 */
  id: string | null;
  kind: 'warmup' | 'remediation' | 'review' | 'quiz';
  topicIds: string[];
  cardIds: string[];
}

const topicTitle = (id: string) => {
  const topic = BUILTIN_PACK.topicById.get(id);
  return topic ? localize(topic.title) : id;
};

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
  // 节奏读谱的复习任务（M10）只有节奏卡，用节奏读谱的控制器
  const rhythmTask = useMemo(() => {
    const cards = learning.cardsByIds(task.cardIds);
    return cards.length > 0 && cards.every((c) => c.kind === 'rhythm');
  }, [task]);
  const controller = rhythmTask ? rhythmSession : practice;
  const practiceStatus = usePractice((v) => v.status);
  const rhythm = useRhythmSession((v) => v);
  const status = rhythmTask ? rhythm.status : practiceStatus;
  const [outcomes, setOutcomes] = useState<TopicOutcome[] | null>(null);
  const [wrong, setWrong] = useState<string[] | null>(null);
  const [follow, setFollow] = useState<RunnableTask | null>(null);
  const [completed, setCompleted] = useState(false);

  const start = useCallback(() => {
    setOutcomes(null);
    const cards = learning.cardsByIds(task.cardIds);
    void controller.start(taskSpec(task.kind, cards, { taskId: task.id, topicIds: task.topicIds }));
    const off = controller.onFinish((result: SessionResult) => {
      off();
      setCompleted(result.completed);
      if (!result.completed) return;
      void (async () => {
        let o: TopicOutcome[] = [];
        if (task.kind === 'review') o = await learning.recordTopicReviews(task.topicIds, result);
        if (task.kind === 'quiz') {
          const quiz = await learning.recordQuiz(task.topicIds, result);
          o = quiz.outcomes;
          setWrong(quiz.wrongCardIds);
        }
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
  }, [task, controller]);

  // start 只依赖固定的 task，所以只在挂载时执行一次
  useEffect(() => {
    start();
    return () => {
      practice.dispose();
      rhythmSession.dispose();
    };
  }, [start]);

  useEscapeToFinish(useCallback(() => void navigate({ to: '/' }), [navigate]));

  // 测验之后马上补练答错的卡片
  if (follow) return <TaskRunner key="follow" task={follow} />;
  if (status === 'summary') {
    return (
      <SessionSummaryView
        onAgain={start}
        againLabel={completed ? undefined : t('today.continueTask')}
        backTo="/"
        backLabel={t('learn.backToToday')}
        {...(rhythmTask
          ? { data: { summary: rhythm.summary, saveError: rhythm.saveError, xp: rhythm.xp } }
          : {})}
      >
        {outcomes && outcomes.length > 0 && <TopicOutcomes outcomes={outcomes} />}
        {wrong && (
          <QuizMistakes
            cardIds={wrong}
            onRemediate={() =>
              setFollow({ id: null, kind: 'remediation', topicIds: [], cardIds: wrong })
            }
          />
        )}
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
  const title = `${t(`today.kind.${task.kind}`)}${task.topicIds.length > 0 ? ` · ${task.topicIds.map(topicTitle).join(listSep())}` : ''}`;
  return rhythmTask ? <RhythmRunner title={title} /> : <SessionRunner title={title} />;
}

/** 测验答错的卡片：马上补练，或者明天出现在"针对性补救"任务里 */
function QuizMistakes({ cardIds, onRemediate }: { cardIds: string[]; onRemediate: () => void }) {
  const { t } = useTranslation();
  if (cardIds.length === 0) {
    return <p className="text-sm text-mark-correct">{t('today.quizAllRight')}</p>;
  }
  const intervalLabel = (i: IntervalName) => t(`practice.intervals.${i}`);
  return (
    <div className="space-y-3 rounded-lg border border-warning/40 p-4">
      <p className="text-sm">
        {t('today.quizWrong', { n: cardIds.length })}
        <span className="font-medium">
          {learning
            .cardsByIds(cardIds)
            .map((c) => cardLabel(c, intervalLabel))
            .join(listSep())}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onRemediate}>{t('today.remediateNow')}</Button>
        <span className="text-sm text-muted-foreground">{t('today.remediateLater')}</span>
      </div>
    </div>
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
