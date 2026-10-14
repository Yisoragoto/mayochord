import { BUILTIN_PACK } from '@mayochord/content';
import type { CardSpeed } from '@mayochord/core';
import { Link } from '@tanstack/react-router';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChordName } from '@/design/ChordName';
import { Button } from '@/design/ui/button';
import { usePractice } from './practice';

/** 卡片 ID → 涉及的和弦（chord:am:name:any → ['am']；transition:c>g:any → ['c', 'g']） */
export function chordsOfCardId(cardId: string): string[] {
  const [kind, body = ''] = cardId.split(':');
  return kind === 'transition' ? body.split('>') : [body];
}

function CardChords({ cardId }: { cardId: string }) {
  const ids = chordsOfCardId(cardId);
  return (
    <span className="inline-flex items-baseline gap-2">
      {ids.map((id, i) => {
        const chord = BUILTIN_PACK.chordById.get(id);
        return (
          <span key={id} className="inline-flex items-baseline gap-2">
            {i > 0 && (
              <ArrowRight className="size-4 self-center text-subtle-foreground" aria-hidden />
            )}
            {chord ? <ChordName symbol={chord.symbol} size="sm" /> : id}
          </span>
        );
      })}
    </span>
  );
}

const sec = (ms: number) => (ms / 1000).toFixed(2);

/** 轮次总结（规格 6.7）：正确率、最慢的和弦、最慢的切换、齐整度。 */
export function SessionSummaryView({ onAgain }: { onAgain: () => void }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const summary = usePractice((v) => v.summary);
  const saveError = usePractice((v) => v.saveError);
  if (!summary) return null;
  const pct = Math.round(summary.accuracy * 100);

  const speed = (s: CardSpeed | null) =>
    s ? (
      <span className="flex flex-wrap items-baseline gap-x-3">
        <CardChords cardId={s.cardId} />
        <span className="font-mono text-sm text-muted-foreground tabular-nums">
          {t('practice.seconds', { s: sec(s.meanReactionMs) })}
        </span>
      </span>
    ) : (
      t('practice.none')
    );

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-10 px-4 py-10 sm:px-6">
      <motion.header
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="space-y-2"
      >
        <p className="font-mono text-xs tracking-[0.2em] text-primary uppercase">
          {t('practice.answered', { n: summary.total })}
        </p>
        <h1 className="font-cjk-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('practice.summaryTitle')}
        </h1>
      </motion.header>

      {summary.total === 0 ? (
        <p className="text-muted-foreground">{t('practice.nothingAnswered')}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <div>
              <div className="text-sm text-muted-foreground">{t('practice.accuracy')}</div>
              <div
                className="font-display-chord text-[length:var(--text-chord-lg)] leading-none tabular-nums"
                data-testid="summary-accuracy"
              >
                {pct}
                <span className="text-[0.45em] text-muted-foreground">%</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 pb-2 font-mono text-sm text-muted-foreground tabular-nums">
              {summary.timedOut > 0 && (
                <span>{t('practice.timedOutCount', { n: summary.timedOut })}</span>
              )}
              {summary.hintsUsed > 0 && (
                <span>{t('practice.hintsCount', { n: summary.hintsUsed })}</span>
              )}
            </div>
          </div>

          <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
            <Stat label={t('practice.meanReaction')}>
              {summary.meanReactionMs === null
                ? t('practice.none')
                : t('practice.seconds', { s: sec(summary.meanReactionMs) })}
            </Stat>
            <Stat label={t('practice.bestStreak')}>{summary.bestStreak}</Stat>
            {summary.slowestChord && (
              <Stat label={t('practice.slowestChord')}>{speed(summary.slowestChord)}</Stat>
            )}
            {summary.slowestTransition && (
              <Stat label={t('practice.slowestTransition')}>
                {speed(summary.slowestTransition)}
              </Stat>
            )}
            <Stat label={t('practice.meanSpread')} wide>
              {summary.meanSpreadMs === null ? (
                t('practice.none')
              ) : (
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <span>{t('settings.ms', { n: Math.round(summary.meanSpreadMs) })}</span>
                  {summary.notTogether > 0 && (
                    <span className="text-sm text-warning">
                      {t('practice.notTogetherCount', { n: summary.notTogether })}
                    </span>
                  )}
                </span>
              )}
            </Stat>
          </dl>
        </>
      )}

      {saveError && <p className="text-sm text-warning">{t('practice.saveError')}</p>}

      <div className="flex flex-wrap gap-3">
        <Button size="lg" onClick={onAgain}>
          <RotateCcw />
          {t('practice.again')}
        </Button>
        <Button size="lg" variant="outline" asChild>
          <Link to="/practice">{t('practice.changeSetup')}</Link>
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? 'space-y-1 bg-card p-4 sm:col-span-2' : 'space-y-1 bg-card p-4'}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-lg font-medium tabular-nums">{children}</dd>
    </div>
  );
}
