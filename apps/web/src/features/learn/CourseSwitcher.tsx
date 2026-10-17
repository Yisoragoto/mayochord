import { BUILTIN_PACK } from '@mayochord/content';
import { BookOpen, Music } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { localize } from '@/lib/localize';
import { cn } from '@/lib/utils';
import { useSettings } from '@/stores/settings';
import { learning, switchCourse, useLearning } from './service';

const ICONS: Record<string, typeof Music> = { chords: Music, reading: BookOpen };

/** 当前课程的 ID（设置里的课程不存在时用第一门） */
export function useCurrentCourse(): string {
  useSettings((s) => s.settings.activeCourse);
  return learning.currentCourse();
}

/**
 * 选择当前课程（像 Math Academy 那样分开的课程）：每门显示已掌握 / 全部。
 * 换课程后，今天还没开始的新课换成这门课程的；复习照常。
 */
export function CourseSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const current = useCurrentCourse();
  const statuses = useLearning((s) => s.snapshot?.statuses);
  const loading = useLearning((s) => s.loading);
  if (BUILTIN_PACK.courses.length < 2) return null;
  return (
    <div
      role="radiogroup"
      aria-label={t('course.label')}
      className={cn('grid gap-2 sm:grid-cols-2', className)}
    >
      {BUILTIN_PACK.courses.map((c) => {
        const Icon = ICONS[c.id] ?? BookOpen;
        const done = c.topicIds.filter((id) => {
          const s = statuses?.get(id);
          return s === 'mastered' || s === 'review';
        }).length;
        const active = c.id === current;
        return (
          // biome-ignore lint/a11y/useSemanticElements: 卡片式的单选按钮（带进度条），用 button + role=radio
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={loading && !active}
            onClick={() => void switchCourse(c.id)}
            data-testid="course-option"
            data-course-id={c.id}
            className={cn(
              'flex min-w-0 items-start gap-3 rounded-xl border p-3 text-left transition-colors duration-[var(--dur-fast)]',
              active
                ? 'border-primary bg-primary/8'
                : 'border-border bg-card hover:border-border-strong hover:bg-surface-2',
            )}
          >
            <Icon
              className={cn(
                'mt-0.5 size-5 shrink-0',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
              aria-hidden
            />
            <span className="min-w-0 flex-1 space-y-1.5">
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{localize(c.title)}</span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {t('course.progress', { n: done, total: c.topicIds.length })}
                </span>
              </span>
              <span className="block h-1 overflow-hidden rounded-full bg-surface-2">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${(done / Math.max(1, c.topicIds.length)) * 100}%` }}
                />
              </span>
              <span className="line-clamp-2 block text-xs text-muted-foreground">
                {localize(c.summary)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
