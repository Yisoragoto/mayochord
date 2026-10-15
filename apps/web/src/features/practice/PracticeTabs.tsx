import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** 自由练习的入口：和弦练习（看名弹和弦、切换）、跟拍弹进行、曲谱跟弹（M7） */
export function PracticeTabs({ current }: { current: 'chords' | 'progression' | 'scores' }) {
  const { t } = useTranslation();
  const item = (active: boolean) =>
    cn(
      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-[var(--dur-fast)]',
      active
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
    );
  return (
    <nav
      aria-label={t('practice.tabs')}
      className="inline-flex gap-1 rounded-lg border border-border p-1"
    >
      <Link
        to="/practice"
        className={item(current === 'chords')}
        aria-current={current === 'chords' ? 'page' : undefined}
      >
        {t('practice.tabChords')}
      </Link>
      <Link
        to="/practice/progression"
        className={item(current === 'progression')}
        aria-current={current === 'progression' ? 'page' : undefined}
      >
        {t('practice.tabProgression')}
      </Link>
      <Link
        to="/scores"
        className={item(current === 'scores')}
        aria-current={current === 'scores' ? 'page' : undefined}
      >
        {t('practice.tabScores')}
      </Link>
    </nav>
  );
}
