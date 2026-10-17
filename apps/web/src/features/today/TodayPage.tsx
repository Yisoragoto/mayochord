import { BUILTIN_PACK } from '@mayochord/content';
import { currentStreak, dayKey, lastDays, xpByDay } from '@mayochord/core';
import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  BookOpen,
  Check,
  ClipboardCheck,
  Dumbbell,
  Flame,
  Gauge,
  Network,
  Repeat2,
  Shuffle,
  SkipForward,
  Sun,
  Undo2,
  Wrench,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/design/ui/button';
import { CourseSwitcher, useCurrentCourse } from '@/features/learn/CourseSwitcher';
import { learning, refreshLearning, useLearning } from '@/features/learn/service';
import { dayParams, wallNow } from '@/lib/clock';
import { clauseSep, listSep, locale, localize } from '@/lib/localize';
import { useDocumentTitle } from '@/lib/use-document-title';
import { cn } from '@/lib/utils';
import { type StoredTask, tryRepositories } from '@/storage';
import { useSettings } from '@/stores/settings';

const DAY = 86_400_000;
const topicTitle = (id: string) => {
  const topic = BUILTIN_PACK.topicById.get(id);
  return topic ? localize(topic.title) : id;
};

const KIND_ICON = {
  warmup: Sun,
  remediation: Wrench,
  review: Repeat2,
  quiz: ClipboardCheck,
  lesson: BookOpen,
} as const;

/** 最近 7 天每天的 XP（来自练习记录） */
function useWeekXp(refreshKey: unknown) {
  const [days, setDays] = useState<{ day: string; xp: number }[]>([]);
  useEffect(() => {
    void refreshKey;
    const repos = tryRepositories();
    const now = wallNow();
    const today = dayKey(now, dayParams());
    if (!repos) return;
    repos.sessions
      .since(now - 8 * DAY)
      .then((sessions) => {
        const xp = xpByDay(
          sessions.map((s) => ({ ts: s.startedAt, xp: s.xp ?? 0 })),
          (ts) => dayKey(ts, dayParams()),
        );
        setDays(lastDays(xp, today, 7));
      })
      .catch(() => {});
  }, [refreshKey]);
  return days;
}

export function TodayPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('today.title'));
  const { plan, snapshot, loading, error } = useLearning();
  const goal = useSettings((s) => s.settings.dailyXpGoal);
  const settingsLoaded = useSettings((s) => s.loaded);
  const week = useWeekXp(plan);
  const course = useCurrentCourse();
  const courseTopics = BUILTIN_PACK.courseById.get(course)?.topicIds ?? [];
  const lessonTopics = learning.lessonTopicsFor(course, snapshot?.statuses);

  useEffect(() => {
    if (settingsLoaded) void refreshLearning();
  }, [settingsLoaded]);

  const xpToday = week[week.length - 1]?.xp ?? 0;
  const streak = currentStreak(
    new Map(week.map((d) => [d.day, d.xp])),
    dayKey(wallNow(), dayParams()),
  );
  // 当前课程的进度
  const masteredCount = snapshot
    ? courseTopics.filter((id) => {
        const s = snapshot.statuses.get(id);
        return s === 'mastered' || s === 'review';
      }).length
    : 0;

  const date = new Intl.DateTimeFormat(locale(), {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date(wallNow()));

  const tasks = plan?.tasks ?? [];
  // 今天的任务做完后，可以继续学已经解锁的新主题（不强制）
  const extra = snapshot
    ? BUILTIN_PACK.graph.order
        .filter((id) => {
          const s = snapshot.statuses.get(id);
          return lessonTopics.has(id) && (s === 'available' || s === 'learning');
        })
        .slice(0, 3)
    : [];
  const nextTask = tasks.find((x) => x.status === 'pending');
  // 还没开始学任何主题：建议先做诊断测试（有基础的人不用从头学）
  const fresh =
    snapshot !== null &&
    [...snapshot.topicProgress.values()].every(
      (p) => p.lessonStartedAt === null && p.masteredAt === null,
    );
  const totalMinutes = tasks
    .filter((x) => x.status !== 'skipped')
    .reduce((s, x) => s + x.minutes, 0);

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_18rem]">
      <section aria-labelledby="today-title" className="space-y-6">
        <header>
          <p className="mb-2 font-mono text-xs tracking-[0.2em] text-primary uppercase">{date}</p>
          <h1
            id="today-title"
            className="font-cjk-heading text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            {t('today.greeting')}
          </h1>
          <p className="mt-2 max-w-xl text-muted-foreground">{t('today.subtitle')}</p>
        </header>
        <CourseSwitcher />

        {error && <p className="text-sm text-warning">{t('today.error')}</p>}
        {fresh && (
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-primary/40 bg-primary/8 p-4">
            <Gauge className="size-6 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t('today.diagnosticTitle')}</p>
              <p className="text-sm text-muted-foreground">{t('today.diagnosticBody')}</p>
            </div>
            <Button asChild size="sm">
              <Link to="/diagnostic">{t('today.diagnosticStart')}</Link>
            </Button>
          </div>
        )}
        {!plan && loading && (
          <div className="space-y-3" role="status" aria-label={t('today.loading')}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-2/60" />
            ))}
          </div>
        )}

        {plan && tasks.length === 0 && (
          <EmptyState title={t('today.nothing')} body={t('today.nothingBody')} />
        )}
        {plan && tasks.length > 0 && !nextTask && (
          <EmptyState title={t('today.allDone')} body={t('today.allDoneBody')} done />
        )}
        {plan && !nextTask && extra.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t('today.extraTitle')}</p>
            <ul className="flex flex-wrap gap-2">
              {extra.map((id) => (
                <li key={id}>
                  <Button asChild variant="outline" size="sm">
                    <Link to="/learn/$topicId" params={{ topicId: id }}>
                      <BookOpen />
                      {topicTitle(id)}
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {plan && tasks.length > 0 && (
          <>
            <p className="font-mono text-xs text-muted-foreground tabular-nums">
              {t('today.totalMinutes', { n: totalMinutes })}
            </p>
            <ol className="space-y-3">
              {tasks.map((task, i) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  index={i}
                  isNext={task.id === nextTask?.id}
                  date={plan.date}
                  canReplace={task.kind === 'lesson' && plan.spareLessons.length > 0}
                />
              ))}
            </ol>
          </>
        )}

        <div className="flex flex-wrap gap-3 pt-2">
          <Button asChild variant="outline">
            <Link to="/graph">
              <Network />
              {t('today.openGraph')}
            </Link>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/practice">
              <Dumbbell />
              {t('today.freePractice')}
            </Link>
          </Button>
        </div>
      </section>

      <aside className="space-y-6">
        <XpRing xp={xpToday} goal={goal} />
        <ul className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-1">
          <Stat icon={<Flame className="size-4 text-primary" aria-hidden />}>
            {streak > 0 ? t('today.streak', { n: streak }) : t('today.streakNone')}
          </Stat>
          <Stat icon={<Repeat2 className="size-4 text-warning" aria-hidden />}>
            {plan && plan.dueTopics.length > 0
              ? t('today.due', { n: plan.dueTopics.length })
              : t('today.noDue')}
          </Stat>
          <Stat icon={<Check className="size-4 text-mark-correct" aria-hidden />}>
            {t('today.mastered', { n: masteredCount, total: courseTopics.length })}
          </Stat>
        </ul>
        <WeekBars days={week} goal={goal} />
      </aside>
    </div>
  );
}

function EmptyState({
  title,
  body,
  done = false,
}: {
  title: string;
  body: string;
  done?: boolean;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border-strong p-6">
      <h2 className={cn('font-cjk-heading text-xl font-semibold', done && 'text-mark-correct')}>
        {title}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function Stat({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
      {icon}
      <span>{children}</span>
    </li>
  );
}

function TaskCard({
  task,
  index,
  isNext,
  date,
  canReplace,
}: {
  task: StoredTask;
  index: number;
  isNext: boolean;
  date: string;
  canReplace: boolean;
}) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const Icon = KIND_ICON[task.kind];
  const done = task.status === 'done';
  const skipped = task.status === 'skipped';
  const update = async (patch: Partial<StoredTask>) => {
    await learning.updateTask(date, task.id, patch);
    await refreshLearning();
  };
  const replace = async () => {
    await learning.replaceLesson(date, task.id);
    await refreshLearning();
  };
  const title =
    task.kind === 'warmup' || task.kind === 'remediation'
      ? t(`today.kind.${task.kind}`)
      : `${t(`today.kind.${task.kind}`)} · ${task.topicIds.map(topicTitle).join(listSep())}`;

  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.04 }}
      className={cn(
        'flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4 sm:flex-nowrap',
        isNext ? 'border-primary shadow-[inset_0_0_0_1px_var(--primary)]' : 'border-border',
        (done || skipped) && 'opacity-60',
      )}
      data-testid="task"
      data-task-kind={task.kind}
      data-task-status={task.status}
    >
      <div
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-full',
          done ? 'bg-mark-correct/15 text-mark-correct' : 'bg-surface-2 text-foreground',
        )}
      >
        {done ? <Check className="size-5" aria-hidden /> : <Icon className="size-5" aria-hidden />}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className={cn('font-medium', skipped && 'line-through')}>{title}</h2>
        <p className="text-sm text-muted-foreground">{t(`today.kindHint.${task.kind}`)}</p>
        {task.covers.length > 0 && (
          <p className="mt-1 text-xs text-subtle-foreground">
            {t('today.covers', { topics: task.covers.map(topicTitle).join(listSep()) })}
          </p>
        )}
        <p className="mt-1 font-mono text-xs text-subtle-foreground tabular-nums">
          {t('today.minutes', { n: task.minutes })}
          {task.kind !== 'lesson' && ` · ${t('today.cards', { n: task.cardIds.length })}`}
          {done && task.xp > 0 && ` · +${task.xp} XP`}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {done && <span className="text-sm text-mark-correct">{t('today.done')}</span>}
        {skipped && (
          <Button size="sm" variant="ghost" onClick={() => void update({ status: 'pending' })}>
            <Undo2 />
            {t('today.unskip')}
          </Button>
        )}
        {task.status === 'pending' && (
          <>
            {canReplace && (
              <Button size="sm" variant="ghost" onClick={() => void replace()}>
                <Shuffle />
                {t('today.replace')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => void update({ status: 'skipped' })}>
              <SkipForward />
              {t('today.skip')}
            </Button>
            <Button size="sm" variant={isNext ? 'default' : 'outline'} asChild>
              {task.kind === 'lesson' ? (
                <Link
                  to="/learn/$topicId"
                  params={{ topicId: task.topicIds[0] as string }}
                  search={{ task: task.id }}
                >
                  {t('today.start')}
                  <ArrowRight />
                </Link>
              ) : (
                <Link to="/today/task/$taskId" params={{ taskId: task.id }}>
                  {t('today.start')}
                  <ArrowRight />
                </Link>
              )}
            </Button>
          </>
        )}
      </div>
    </motion.li>
  );
}

/** 今日 XP 圆环 */
function XpRing({ xp, goal }: { xp: number; goal: number }) {
  const { t } = useTranslation();
  const r = 44;
  const c = 2 * Math.PI * r;
  const ratio = Math.min(1, xp / goal);
  return (
    <div className="flex items-center gap-4">
      <svg
        width={108}
        height={108}
        viewBox="0 0 108 108"
        role="img"
        aria-label={`${t('today.xpToday')} ${Math.floor(xp)} / ${goal}`}
      >
        <circle cx={54} cy={54} r={r} className="fill-none stroke-surface-2" strokeWidth={9} />
        <circle
          cx={54}
          cy={54}
          r={r}
          className="fill-none stroke-primary transition-[stroke-dashoffset] duration-500"
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
          transform="rotate(-90 54 54)"
        />
        <text
          x={54}
          y={58}
          textAnchor="middle"
          className="fill-foreground font-mono text-[22px] font-semibold"
        >
          {Math.floor(xp)}
        </text>
      </svg>
      <div>
        <div className="text-sm text-muted-foreground">{t('today.xpToday')}</div>
        <div className="font-mono text-sm tabular-nums">{t('today.xpGoal', { n: goal })}</div>
      </div>
    </div>
  );
}

function WeekBars({ days, goal }: { days: { day: string; xp: number }[]; goal: number }) {
  const { t } = useTranslation();
  if (days.length === 0) return null;
  const max = Math.max(goal, ...days.map((d) => d.xp));
  return (
    <figure className="space-y-2">
      <figcaption className="flex items-baseline justify-between text-sm text-muted-foreground">
        {t('today.week')}
        <Link to="/stats" className="underline underline-offset-2 hover:text-foreground">
          {t('today.moreStats')}
        </Link>
      </figcaption>
      <div
        className="flex h-24 items-end gap-1.5"
        role="img"
        aria-label={days.map((d) => `${d.day} ${Math.floor(d.xp)} XP`).join(clauseSep())}
      >
        {days.map((d) => (
          <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
            <div
              className={cn('w-full rounded-sm', d.xp >= goal ? 'bg-primary' : 'bg-primary/40')}
              style={{ height: `${Math.max(2, (d.xp / max) * 80)}px` }}
            />
            <span className="font-mono text-[10px] text-subtle-foreground">{d.day.slice(8)}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}
