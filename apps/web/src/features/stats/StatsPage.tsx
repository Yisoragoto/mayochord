import { BUILTIN_PACK } from '@mayochord/content';
import {
  beatOffsetStats,
  currentStreak,
  dayKey,
  histogram,
  lastDays,
  practiceTotals,
  type ReviewLog,
  reactionTrends,
  stdev,
  type TopicStatus,
  transitionHeatmap,
  xpByDay,
} from '@mayochord/core';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { axis, baseOption, EChart, seriesColor, token } from '@/design/charts/EChart';
import { StatusBadge } from '@/features/graph/GraphPage';
import { refreshLearning, useLearning } from '@/features/learn/service';
import { chordLabel, chordOf } from '@/features/practice/cards-view';
import { OffsetHistogram } from '@/features/progression/RunSummaryView';
import { dayParams, wallNow } from '@/lib/clock';
import { clauseSep, listSep } from '@/lib/localize';
import { useDocumentTitle } from '@/lib/use-document-title';
import { type SessionRecord, tryRepositories } from '@/storage';

const DAYS = 30;
const label = (id: string) => {
  const c = chordOf(id);
  return c ? chordLabel(c) : id;
};

interface Data {
  logs: ReviewLog[];
  sessions: SessionRecord[];
}

function useStatsData() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const repos = tryRepositories();
    if (!repos) {
      setData({ logs: [], sessions: [] });
      return;
    }
    let alive = true;
    const since = wallNow() - (DAYS + 1) * 86_400_000;
    Promise.all([repos.backup.allLogs(), repos.sessions.since(since)])
      .then(([logs, sessions]) => alive && setData({ logs, sessions }))
      .catch(() => alive && setError(true));
    void refreshLearning();
    return () => {
      alive = false;
    };
  }, []);
  return { data, error };
}

/** 统计页（规格 10-7）：掌握进度、每日练习量、反应时间曲线、切换热力图、节拍偏差 */
export function StatsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('stats.title'));
  const { data, error } = useStatsData();
  const snapshot = useLearning((s) => s.snapshot);
  const dayOf = useCallback((ts: number) => dayKey(ts, dayParams()), []);
  const today = dayOf(wallNow());

  const derived = useMemo(() => {
    if (!data) return null;
    const xp = xpByDay(
      data.sessions.map((s) => ({ ts: s.startedAt, ...(s.xp !== undefined ? { xp: s.xp } : {}) })),
      dayOf,
    );
    return {
      totals: practiceTotals(data.logs, dayOf),
      streak: currentStreak(xp, today),
      days: lastDays(xp, today, DAYS),
      trends: reactionTrends(data.logs, dayOf, { limit: 6 }),
      heat: transitionHeatmap(data.logs),
      beat: beatOffsetStats(data.logs, dayOf),
    };
  }, [data, dayOf, today]);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="font-cjk-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('stats.title')}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('stats.subtitle')}</p>
      </header>

      {error && <p className="text-sm text-warning">{t('stats.loadError')}</p>}
      {!derived ? (
        <p className="text-muted-foreground" role="status">
          {t('practice.loading')}
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
            <Tile label={t('stats.answers')}>{derived.totals.answers}</Tile>
            <Tile label={t('stats.accuracy')}>
              {derived.totals.accuracy === null
                ? '—'
                : `${Math.round(derived.totals.accuracy * 100)}%`}
            </Tile>
            <Tile label={t('stats.practiceDays')}>{derived.totals.days}</Tile>
            <Tile label={t('stats.streak')}>{t('stats.streakN', { n: derived.streak })}</Tile>
          </dl>

          <Mastery statuses={snapshot?.statuses ?? null} />

          <Section title={t('stats.dailyTitle')} hint={t('stats.dailyHint', { n: DAYS })}>
            <DailyXp days={derived.days} />
          </Section>

          <Section title={t('stats.trendTitle')} hint={t('stats.trendHint')}>
            {derived.trends.length === 0 ? <Empty /> : <ReactionTrend trends={derived.trends} />}
          </Section>

          <Section title={t('stats.heatTitle')} hint={t('stats.heatHint')}>
            {derived.heat.cells.length === 0 ? <Empty /> : <Heatmap heat={derived.heat} />}
          </Section>

          <Section title={t('stats.beatTitle')} hint={t('stats.beatHint')}>
            {derived.beat.offsets.length === 0 ? (
              <Empty link />
            ) : (
              <BeatOffsets beat={derived.beat} />
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1 bg-card p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-display-chord text-2xl tabular-nums">{children}</dd>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function Empty({ link = false }: { link?: boolean }) {
  const { t } = useTranslation();
  return (
    <p className="rounded-xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">
      {t('stats.empty')}
      {link && (
        <>
          {' '}
          <Link to="/practice/progression" className="underline underline-offset-2">
            {t('stats.toProgression')}
          </Link>
        </>
      )}
    </p>
  );
}

/** 数据表（图表的文字版：屏幕阅读器、色弱时用） */
function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  const { t } = useTranslation();
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">{t('stats.showTable')}</summary>
      <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-border">
        <table className="w-full text-left tabular-nums">
          <thead className="sticky top-0 bg-surface-2">
            <tr>
              {head.map((h) => (
                <th key={h} className="px-3 py-1.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.join('|')} className="border-t border-border">
                {r.map((c, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 表格列
                  <td key={i} className="px-3 py-1.5">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const STATUS_ORDER: TopicStatus[] = ['mastered', 'review', 'learning', 'available', 'locked'];

function Mastery({ statuses }: { statuses: ReadonlyMap<string, TopicStatus> | null }) {
  const { t } = useTranslation();
  if (!statuses) return null;
  const total = BUILTIN_PACK.topics.length;
  const count = (s: TopicStatus) => [...statuses.values()].filter((x) => x === s).length;
  const done = count('mastered') + count('review');
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{t('stats.masteryTitle')}</h2>
        <span className="font-mono text-sm text-muted-foreground tabular-nums">
          {t('stats.masteryCount', { n: done, total })}
        </span>
      </div>
      <div
        className="flex h-3 gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label={STATUS_ORDER.map((s) => `${t(`graph.status.${s}`)} ${count(s)}`).join(
          clauseSep(),
        )}
      >
        {STATUS_ORDER.map((s) => {
          const n = count(s);
          if (n === 0) return null;
          return (
            <span
              key={s}
              className="h-full"
              style={{
                width: `${(n / total) * 100}%`,
                background:
                  s === 'mastered'
                    ? 'var(--mark-correct)'
                    : s === 'review'
                      ? 'var(--warning)'
                      : s === 'learning'
                        ? 'var(--primary)'
                        : s === 'available'
                          ? 'var(--border-strong)'
                          : 'var(--surface-2)',
              }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        {STATUS_ORDER.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <StatusBadge status={s} />
            <span className="font-mono text-sm tabular-nums">{count(s)}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

function DailyXp({ days }: { days: { day: string; xp: number }[] }) {
  const { t } = useTranslation();
  const option = useCallback(
    () => ({
      ...baseOption(),
      tooltip: {
        ...(baseOption().tooltip as object),
        trigger: 'axis',
        valueFormatter: (v: number) => `${v.toFixed(1)} XP`,
      },
      xAxis: { type: 'category', data: days.map((d) => d.day.slice(5)), ...axis() },
      yAxis: { type: 'value', minInterval: 1, ...axis() },
      series: [
        {
          type: 'bar',
          data: days.map((d) => Math.round(d.xp * 10) / 10),
          itemStyle: { color: token('primary'), borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 18,
        },
      ],
    }),
    [days],
  );
  const total = days.reduce((s, d) => s + d.xp, 0);
  return (
    <>
      <EChart
        option={option}
        className="h-56"
        label={t('stats.dailyLabel', { n: days.length, xp: total.toFixed(1) })}
      />
      <DataTable
        head={[t('stats.day'), 'XP']}
        rows={days.filter((d) => d.xp > 0).map((d) => [d.day, d.xp.toFixed(1)])}
      />
    </>
  );
}

function ReactionTrend({ trends }: { trends: ReturnType<typeof reactionTrends> }) {
  const { t } = useTranslation();
  const days = useMemo(
    () => [...new Set(trends.flatMap((tr) => tr.points.map((p) => p.day)))].sort(),
    [trends],
  );
  const option = useCallback(
    () => ({
      ...baseOption(),
      tooltip: {
        ...(baseOption().tooltip as object),
        trigger: 'axis',
        valueFormatter: (v: number | null) => (v === null ? '—' : `${(v / 1000).toFixed(2)} s`),
      },
      legend: { top: 0, textStyle: { color: token('muted-foreground') }, icon: 'roundRect' },
      grid: { left: 48, right: 16, top: 40, bottom: 32 },
      xAxis: { type: 'category', data: days.map((d) => d.slice(5)), ...axis() },
      yAxis: {
        type: 'value',
        ...axis(),
        axisLabel: { color: token('muted-foreground'), formatter: (v: number) => `${v / 1000}s` },
      },
      series: trends.map((tr, i) => {
        const byDay = new Map(tr.points.map((p) => [p.day, p.medianMs]));
        return {
          type: 'line',
          name: label(tr.chordId),
          data: days.map((d) => byDay.get(d) ?? null),
          connectNulls: true,
          symbolSize: 8,
          lineStyle: { width: 2, color: seriesColor(i) },
          itemStyle: { color: seriesColor(i), borderColor: token('card'), borderWidth: 2 },
        };
      }),
    }),
    [trends, days],
  );
  return (
    <>
      <EChart
        option={option}
        className="h-72"
        label={t('stats.trendLabel', {
          chords: trends.map((tr) => label(tr.chordId)).join(listSep()),
        })}
      />
      <DataTable
        head={[t('stats.chord'), t('stats.day'), t('stats.median'), t('stats.count')]}
        rows={trends.flatMap((tr) =>
          tr.points.map((p) => [
            label(tr.chordId),
            p.day,
            `${(p.medianMs / 1000).toFixed(2)} s`,
            p.count,
          ]),
        )}
      />
    </>
  );
}

function Heatmap({ heat }: { heat: ReturnType<typeof transitionHeatmap> }) {
  const { t } = useTranslation();
  const names = heat.chords.map(label);
  const values = heat.cells.flatMap((c) => (c.meanMs === null ? [] : [c.meanMs]));
  const option = useCallback(
    () => ({
      ...baseOption(),
      tooltip: {
        ...(baseOption().tooltip as object),
        formatter: (p: { data: [number, number, number | null, number, number] }) => {
          const [x, y, ms, count, acc] = p.data;
          return `${names[x]} → ${names[y]}<br/>${
            ms === null ? '—' : `${(ms / 1000).toFixed(2)} s`
          } · ${t('stats.countN', { n: count })} · ${Math.round(acc * 100)}%`;
        },
      },
      grid: { left: 64, right: 96, top: 32, bottom: 32 },
      xAxis: {
        type: 'category',
        data: names,
        name: t('stats.from'),
        nameLocation: 'end',
        nameGap: 8,
        ...axis(),
        splitArea: { show: false },
      },
      yAxis: {
        type: 'category',
        data: names,
        name: t('stats.to'),
        nameLocation: 'end',
        nameGap: 8,
        nameRotate: 0,
        ...axis(),
      },
      visualMap: {
        min: Math.min(...values),
        max:
          Math.max(...values) > Math.min(...values) ? Math.max(...values) : Math.min(...values) + 1,
        // 数据是 [从, 到, 平均用时, 次数, 正确率]：颜色只表示平均用时
        dimension: 2,
        calculable: false,
        orient: 'vertical',
        right: 8,
        top: 'middle',
        itemHeight: 140,
        text: [t('stats.slow'), t('stats.fast')],
        textStyle: { color: token('muted-foreground') },
        // 单一色相：淡 → 浓 = 快 → 慢（淡的一端也要和卡片背景分得开）
        inRange: { color: [token('border-strong'), token('primary')] },
      },
      series: [
        {
          type: 'heatmap',
          data: heat.cells.map((c) => [
            heat.chords.indexOf(c.from),
            heat.chords.indexOf(c.to),
            c.meanMs,
            c.count,
            c.accuracy,
          ]),
          itemStyle: { borderColor: token('card'), borderWidth: 2, borderRadius: 4 },
        },
      ],
    }),
    [heat, names, values, t],
  );
  const slowest = [...heat.cells]
    .filter((c) => c.meanMs !== null)
    .sort((a, b) => (b.meanMs as number) - (a.meanMs as number))[0];
  return (
    <>
      <EChart
        option={option}
        className="h-80"
        label={t('stats.heatLabel', {
          n: heat.cells.length,
          slowest: slowest ? `${label(slowest.from)} → ${label(slowest.to)}` : '—',
        })}
      />
      <DataTable
        head={[
          t('stats.from'),
          t('stats.to'),
          t('stats.meanTime'),
          t('stats.count'),
          t('stats.accuracy'),
        ]}
        rows={heat.cells.map((c) => [
          label(c.from),
          label(c.to),
          c.meanMs === null ? '—' : `${(c.meanMs / 1000).toFixed(2)} s`,
          c.count,
          `${Math.round(c.accuracy * 100)}%`,
        ])}
      />
    </>
  );
}

function BeatOffsets({ beat }: { beat: ReturnType<typeof beatOffsetStats> }) {
  const { t } = useTranslation();
  const sd = stdev(beat.offsets);
  return (
    <div className="space-y-3">
      <p className="text-sm">
        {t('stats.beatSummary', {
          n: beat.offsets.length,
          sd: sd === null ? '—' : Math.round(sd),
        })}
      </p>
      <div className="max-w-2xl">
        <OffsetHistogram bins={histogram(beat.offsets, { min: -200, max: 200, width: 20 })} />
      </div>
      <DataTable
        head={[t('stats.day'), t('stats.count'), t('stats.meanOffset'), t('stats.stdev')]}
        rows={beat.days.map((d) => [d.day, d.count, `${d.meanMs} ms`, `${d.stdevMs} ms`])}
      />
    </div>
  );
}
