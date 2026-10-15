import type { HistogramBin } from '@mayochord/core';
import { Link } from '@tanstack/react-router';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChordName } from '@/design/ChordName';
import { Button } from '@/design/ui/button';
import { clauseSep } from '@/lib/localize';
import { useRun } from './run';
import type { RunSource } from './run-source';

const pct = (x: number) => Math.round(x * 100);

/** 一遍跟拍练习的总结：干净率、节拍偏差分布与稳定性、各和弦与各切换 */
export function RunSummaryView({
  source,
  onAgain,
  againLabel,
  backTo = '/practice/progression',
  backLabel,
  onApplyBpm,
  children,
}: {
  source: RunSource;
  onAgain: () => void;
  againLabel?: string;
  backTo?: '/practice/progression' | '/';
  backLabel?: string;
  /** 采用 85% 规则给出的下次 BPM */
  onApplyBpm?: (bpm: number) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const summary = useRun((v) => v.summary);
  const xp = useRun((v) => v.xp);
  const nextBpm = useRun((v) => v.nextBpm);
  const saveError = useRun((v) => v.saveError);
  const bpm = useRun((v) => v.config?.spec.bpm ?? 0);
  if (!summary) return null;
  const chord = (id: string) => source.steps.find((s) => s.chord.id === id)?.chord;

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-10 px-4 py-10 sm:px-6">
      <motion.header
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="space-y-2"
      >
        <p className="font-mono text-xs tracking-[0.2em] text-primary uppercase">
          {t('progression.played', { n: summary.total, bpm })}
          {xp > 0 && ` · ${t('learn.xpEarned', { xp: xp.toFixed(1) })}`}
        </p>
        <h1 className="font-cjk-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('progression.summaryTitle')}
        </h1>
      </motion.header>

      {summary.total === 0 ? (
        <p className="text-muted-foreground">{t('progression.nothingPlayed')}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <div>
              <div className="text-sm text-muted-foreground">{t('progression.cleanRate')}</div>
              <div
                className="font-display-chord text-[length:var(--text-chord-lg)] leading-none tabular-nums"
                data-testid="run-clean-rate"
              >
                {pct(summary.cleanRate)}
                <span className="text-[0.45em] text-muted-foreground">%</span>
              </div>
            </div>
            <p className="max-w-sm pb-2 text-sm text-muted-foreground">
              {t('progression.cleanRateHint')}
            </p>
          </div>

          <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
            <Stat label={t('progression.accuracy')}>
              {pct(summary.accuracy)}%
              {summary.missed > 0 && (
                <span className="ml-2 text-sm text-warning">
                  {t('progression.missedCount', { n: summary.missed })}
                </span>
              )}
            </Stat>
            <Stat label={t('progression.onBeatRate')}>
              {summary.onBeatRate === null ? t('practice.none') : `${pct(summary.onBeatRate)}%`}
            </Stat>
            <Stat label={t('progression.meanSpread')}>
              {summary.meanSpreadMs === null
                ? t('practice.none')
                : t('settings.ms', { n: summary.meanSpreadMs })}
              {summary.notTogether > 0 && (
                <span className="ml-2 text-sm text-warning">
                  {t('practice.notTogetherCount', { n: summary.notTogether })}
                </span>
              )}
            </Stat>
            <Stat label={t('progression.meanOffset')}>
              {summary.meanOffsetMs === null
                ? t('practice.none')
                : summary.meanOffsetMs === 0
                  ? t('progression.offsetZero')
                  : summary.meanOffsetMs < 0
                    ? t('progression.offsetEarly', { ms: -summary.meanOffsetMs })
                    : t('progression.offsetLate', { ms: summary.meanOffsetMs })}
            </Stat>
            <Stat label={t('progression.stability')} wide>
              {summary.stdevOffsetMs === null
                ? t('practice.none')
                : t('progression.stdev', { ms: summary.stdevOffsetMs })}
            </Stat>
          </dl>

          {summary.offsets.length > 0 && (
            <figure className="space-y-2">
              <figcaption className="text-sm font-medium text-muted-foreground">
                {t('progression.distribution')}
              </figcaption>
              <OffsetHistogram bins={summary.histogram} />
            </figure>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              {t('progression.byTransition')}
            </h2>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {summary.transitions.map((tr) => {
                const a = chord(tr.from);
                const b = chord(tr.to);
                return (
                  <li key={`${tr.from}>${tr.to}`} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="flex flex-1 items-baseline gap-2">
                      {a && <ChordName symbol={a.symbol} size="sm" />}
                      <ArrowRight
                        className="size-3.5 self-center text-subtle-foreground"
                        aria-hidden
                      />
                      {b && <ChordName symbol={b.symbol} size="sm" />}
                    </span>
                    <span className="font-mono text-sm tabular-nums text-muted-foreground">
                      {t('progression.cleanOf', { clean: tr.clean, total: tr.total })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      {nextBpm?.change && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2/50 p-3 text-sm">
          <span className="flex-1">
            {nextBpm.change === 'faster'
              ? t('progression.suggestFaster', { bpm: nextBpm.bpm })
              : t('progression.suggestSlower', { bpm: nextBpm.bpm })}
          </span>
          {onApplyBpm && (
            <Button size="sm" variant="outline" onClick={() => onApplyBpm(nextBpm.bpm)}>
              {t('progression.applyBpm', { bpm: nextBpm.bpm })}
            </Button>
          )}
        </div>
      )}

      {children}

      {saveError && <p className="text-sm text-warning">{t('practice.saveError')}</p>}

      <div className="flex flex-wrap gap-3">
        <Button size="lg" onClick={onAgain}>
          <RotateCcw />
          {againLabel ?? t('progression.again')}
        </Button>
        <Button size="lg" variant="outline" asChild>
          <Link to={backTo}>{backLabel ?? t('practice.changeSetup')}</Link>
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? 'space-y-1 bg-card p-4 sm:col-span-3' : 'space-y-1 bg-card p-4'}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-lg font-medium tabular-nums">{children}</dd>
    </div>
  );
}

/** 节拍偏差分布：横轴 −200 … +200 ms（早 ← 0 → 晚），中间是拍点 */
export function OffsetHistogram({ bins }: { bins: readonly HistogramBin[] }) {
  const { t } = useTranslation();
  const max = Math.max(1, ...bins.map((b) => b.count));
  const W = 400;
  const H = 96;
  const bw = W / bins.length;
  const min = bins[0]?.from ?? -200;
  const span = (bins.at(-1)?.to ?? 200) - min;
  const zeroX = ((0 - min) / span) * W;
  return (
    <svg
      viewBox={`0 0 ${W} ${H + 18}`}
      className="block h-auto w-full"
      role="img"
      aria-label={t('progression.distributionLabel', {
        values: bins
          .filter((b) => b.count > 0)
          .map((b) => `${b.from}…${b.to} ms：${b.count}`)
          .join(clauseSep()),
      })}
    >
      {bins.map((b, i) => {
        const h = (b.count / max) * (H - 4);
        return (
          <rect
            key={b.from}
            x={i * bw + 1}
            y={H - h}
            width={bw - 2}
            height={h}
            rx={2}
            fill={Math.abs(b.from + 10) <= 40 ? 'var(--mark-correct)' : 'var(--primary)'}
            opacity={b.count === 0 ? 0 : 0.85}
          />
        );
      })}
      <line x1={0} x2={W} y1={H} y2={H} stroke="var(--border-strong)" />
      <line
        x1={zeroX}
        x2={zeroX}
        y1={0}
        y2={H}
        stroke="var(--foreground)"
        strokeDasharray="3 3"
        opacity={0.5}
      />
      <text x={2} y={H + 14} className="fill-muted-foreground text-[10px]">
        {t('progression.earlyAxis')}
      </text>
      <text x={zeroX} y={H + 14} textAnchor="middle" className="fill-muted-foreground text-[10px]">
        0
      </text>
      <text x={W - 2} y={H + 14} textAnchor="end" className="fill-muted-foreground text-[10px]">
        {t('progression.lateAxis')}
      </text>
    </svg>
  );
}
