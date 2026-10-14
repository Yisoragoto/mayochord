import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/design/ui/button';
import { useDocumentTitle } from '@/lib/use-document-title';
import { practice, usePractice } from './practice';
import { CenteredMessage, SessionRunner } from './SessionRunner';
import { SessionSummaryView } from './SessionSummaryView';
import type { PracticeSearch } from './search';

/** Esc：练习中结束这一轮，结束后执行 onLeave */
export function useEscapeToFinish(onLeave: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (practice.view.status === 'running') practice.finish();
      else onLeave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onLeave]);
}

/** 自由练习（专注模式） */
export function PracticeSessionPage({ config }: { config: PracticeSearch }) {
  const { t } = useTranslation();
  useDocumentTitle(t('practice.title'));
  const navigate = useNavigate();
  const status = usePractice((v) => v.status);
  const { groupId, drill, mode, length } = config;

  useEffect(() => {
    void practice.startPractice({ groupId, drill, mode, length });
    return () => practice.dispose();
  }, [groupId, drill, mode, length]);

  useEscapeToFinish(() => void navigate({ to: '/practice' }));

  if (status === 'summary') {
    return (
      <SessionSummaryView
        onAgain={() => void practice.startPractice({ groupId, drill, mode, length })}
      />
    );
  }
  if (status === 'empty') {
    return (
      <CenteredMessage>
        <p>{t('practice.empty')}</p>
        <Button asChild variant="outline">
          <Link to="/practice">{t('practice.back')}</Link>
        </Button>
      </CenteredMessage>
    );
  }
  if (status !== 'running') return <LoadingScreen />;
  return <SessionRunner />;
}

export function LoadingScreen() {
  const { t } = useTranslation();
  return (
    <CenteredMessage>
      <p className="text-muted-foreground" role="status">
        {t('practice.loading')}
      </p>
    </CenteredMessage>
  );
}
