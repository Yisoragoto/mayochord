import type { EChartsCoreOption } from 'echarts/core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

type ECharts = ReturnType<typeof import('echarts/core')['init']>;

/** 读当前主题的 CSS 令牌（图表的颜色跟着白天/夜间切换） */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}

export const CHART_SERIES = 6;
export const seriesColor = (i: number) => token(`chart-${(i % CHART_SERIES) + 1}`);

/** 图表共用的坐标轴、提示框样式（坐标轴和网格线退到后面） */
export function baseOption(): EChartsCoreOption {
  const muted = token('muted-foreground');
  const border = token('border');
  return {
    textStyle: { fontFamily: 'inherit', color: muted },
    grid: { left: 48, right: 16, top: 24, bottom: 32, containLabel: false },
    tooltip: {
      backgroundColor: token('popover'),
      borderColor: token('border-strong'),
      textStyle: { color: token('popover-foreground') },
    },
    axisStyle: { line: border },
  };
}

export const axis = () => ({
  axisLine: { lineStyle: { color: token('border-strong') } },
  axisTick: { show: false },
  axisLabel: { color: token('muted-foreground') },
  splitLine: { lineStyle: { color: token('border'), type: 'dashed' as const } },
});

/** <html data-theme> 的当前值（跟随系统时，系统切换深浅色也会变） */
function useDocumentTheme(): string | undefined {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme);
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(root.dataset.theme));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

/**
 * ECharts（规格第 3 节：统计页用 ECharts，懒加载）。option 由一个函数生成，
 * 在加载后和主题切换时重新计算（颜色取自当前主题的令牌）。
 */
export function EChart({
  option,
  label,
  className,
}: {
  option: () => EChartsCoreOption;
  /** 屏幕阅读器读出的图表概要 */
  label: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const theme = useDocumentTheme();

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    import('./echarts-setup')
      .then(({ echarts }) => {
        if (cancelled || !ref.current) return;
        chart.current = echarts.init(ref.current, null, { renderer: 'svg' });
        observer = new ResizeObserver(() => chart.current?.resize());
        observer.observe(ref.current);
        setState('ready');
      })
      .catch(() => !cancelled && setState('error'));
    return () => {
      cancelled = true;
      observer?.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 主题变了要重新取令牌颜色
  useEffect(() => {
    if (state !== 'ready' || !chart.current) return;
    chart.current.setOption(option(), true);
  }, [state, option, theme]);

  return (
    <div className={cn('relative', className)} role="img" aria-label={label}>
      <div ref={ref} className="size-full" />
      {state !== 'ready' && (
        <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          {state === 'loading' ? t('stats.chartLoading') : t('stats.chartError')}
        </p>
      )}
    </div>
  );
}
