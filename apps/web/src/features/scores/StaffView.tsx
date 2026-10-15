import type { Score } from '@mayochord/core';
import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { ScoreLayout } from './render-score';
import type { NoteMark } from './score-player';
import './score.css';

export interface StaffViewProps {
  score: Score;
  from: number;
  to: number;
  /** 当前要弹的音（演奏音 id） */
  current: readonly number[];
  marks: ReadonlyMap<number, NoteMark>;
  /** 结束后每个小节的错误率（0–1），用来着色 */
  heat?: ReadonlyMap<number, number> | null;
  /** 保持在视野里的小节 */
  focusMeasure: number;
  /** 点击小节：设为练习范围（shift = 设为结尾） */
  onMeasureClick?: (index: number, shift: boolean) => void;
  className?: string;
}

const CLASSES = ['mc-now', 'mc-ok', 'mc-bad'];

/** 整首曲子的五线谱（VexFlow，懒加载）：当前音高亮，弹过的音着色，自动滚到当前小节 */
export function StaffView({
  score,
  from,
  to,
  current,
  marks,
  heat,
  focusMeasure,
  onMeasureClick,
  className,
}: StaffViewProps) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [layout, setLayout] = useState<ScoreLayout | null>(null);
  const [failed, setFailed] = useState(false);
  const styled = useRef(new Set<Element>());

  // 跟随容器宽度（变化超过 24 px 才重排）
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.clientWidth);
      setWidth((prev) => (Math.abs(prev - w) > 24 ? w : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!width || !canvas.current) return;
    let cancelled = false;
    setFailed(false);
    import('./render-score')
      .then(async ({ renderScore, fontsReady }) => {
        await fontsReady();
        if (cancelled || !canvas.current) return;
        styled.current.clear();
        setLayout(renderScore(canvas.current, score, width));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [score, width]);

  // 高亮：只改动有变化的元素的 class
  useEffect(() => {
    if (!layout) return;
    for (const el of styled.current) el.classList.remove(...CLASSES);
    styled.current.clear();
    const apply = (id: number, cls: string) => {
      for (const el of layout.noteEls.get(id) ?? []) {
        el.classList.remove(...CLASSES);
        el.classList.add(cls);
        styled.current.add(el);
      }
    };
    for (const [id, m] of marks) apply(id, m === 'ok' ? 'mc-ok' : 'mc-bad');
    for (const id of current) apply(id, 'mc-now');
  }, [layout, marks, current]);

  // 当前小节不在视野里时滚过去
  useEffect(() => {
    const box = layout?.measures.find((m) => m.index === focusMeasure);
    const el = scroller.current;
    if (!box || !el) return;
    const top = el.scrollTop;
    const bottom = top + el.clientHeight;
    if (box.y < top + 8 || box.y + box.h > bottom - 8) {
      el.scrollTo({ top: Math.max(0, box.y - 24), behavior: 'smooth' });
    }
  }, [layout, focusMeasure]);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!layout || !onMeasureClick || !canvas.current) return;
    const rect = canvas.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const box = layout.measures.find((m) => x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h);
    if (box) onMeasureClick(box.index, e.shiftKey);
  };

  return (
    <div
      ref={scroller}
      className={cn(
        'relative overflow-x-hidden overflow-y-auto rounded-xl border border-border bg-card [scrollbar-gutter:stable]',
        className,
      )}
      data-testid="staff-view"
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 点击小节只是快捷方式，练习范围也可以用上方的选择框设定 */}
      <div className="relative" onClick={onClick} role="img" aria-label={t('scores.staffLabel')}>
        {layout?.measures.map((m) => {
          const inRange = m.index >= from && m.index <= to;
          const rate = heat?.get(m.index);
          return (
            <div
              key={m.index}
              aria-hidden
              className={cn(
                'pointer-events-none absolute rounded-sm',
                inRange ? 'bg-primary/[0.04]' : 'bg-background/40',
                rate !== undefined &&
                  rate > 0 &&
                  (rate >= 0.25 ? 'bg-mark-extra/15' : 'bg-warning/15'),
              )}
              style={{ left: m.x, top: m.y, width: m.w, height: m.h }}
            />
          );
        })}
        <div ref={canvas} className="mc-score relative text-foreground" />
      </div>
      {!layout && (
        <div className="grid h-40 place-items-center text-sm text-muted-foreground">
          {failed ? t('chords.staffError') : t('practice.loading')}
        </div>
      )}
    </div>
  );
}
