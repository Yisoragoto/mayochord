import type { ChordLabel, Score } from '@mayochord/core';
import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChordName } from '@/design/ChordName';
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
  /** 自动标出的和弦（显示在每行五线谱上方）；不显示为 null */
  chords?: readonly ChordLabel[] | null;
  /** 保持在视野里的小节 */
  focusMeasure: number;
  /** 点击小节：设为练习范围（shift = 设为结尾） */
  onMeasureClick?: (index: number, shift: boolean) => void;
  /** 正在弹：显示播放光标、当前小节底色 */
  active?: boolean;
  /** 谱面顶部的标题、作者 */
  title?: string;
  composer?: string | null;
  className?: string;
}

/** 播放光标：当前这组音的位置（相对谱面） */
interface Cursor {
  x: number;
  w: number;
  y: number;
  h: number;
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
  chords,
  focusMeasure,
  onMeasureClick,
  active = false,
  title,
  composer,
  className,
}: StaffViewProps) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [layout, setLayout] = useState<ScoreLayout | null>(null);
  const [failed, setFailed] = useState(false);
  const [cursor, setCursor] = useState<Cursor | null>(null);
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

  // 播放光标：罩住当前这组音（横向取音符的位置，纵向取这个小节的两个谱表）
  useEffect(() => {
    const host = canvas.current;
    const box = layout?.measures.find((m) => m.index === focusMeasure);
    if (!layout || !host || !box || current.length === 0) {
      setCursor(null);
      return;
    }
    const origin = host.getBoundingClientRect();
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const id of current) {
      for (const el of layout.noteEls.get(id) ?? []) {
        // 只取符头（不含符干、符杠），光标窄一些
        const heads = el.querySelectorAll('.vf-notehead');
        for (const h of heads.length ? heads : [el]) {
          const r = h.getBoundingClientRect();
          lo = Math.min(lo, r.left - origin.left);
          hi = Math.max(hi, r.right - origin.left);
        }
      }
    }
    if (!Number.isFinite(lo)) {
      setCursor(null);
      return;
    }
    const w = Math.max(16, hi - lo + 10);
    setCursor({ x: (lo + hi) / 2 - w / 2, w, y: box.y, h: box.h });
  }, [layout, current, focusMeasure]);

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
      // 谱面像一张纸：深色模式下也用浅色（局部 data-theme），和原谱一样黑字白底
      data-theme="light"
      className={cn(
        'mc-paper relative overflow-x-hidden overflow-y-auto rounded-xl bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.12),0_12px_32px_-12px_rgb(0_0_0/0.35)] [scrollbar-gutter:stable]',
        className,
      )}
      data-testid="staff-view"
    >
      {title && (
        <header className="mc-paper-title px-6 pt-6 pb-1 text-center">
          <p className="text-2xl leading-tight sm:text-3xl">{title}</p>
          {composer && <p className="mt-1 text-right text-sm text-muted-foreground">{composer}</p>}
        </header>
      )}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 点击小节只是快捷方式，练习范围也可以用上方的选择框设定 */}
      <div className="relative" onClick={onClick} role="img" aria-label={t('scores.staffLabel')}>
        {layout?.measures.map((m) => {
          const inRange = m.index >= from && m.index <= to;
          const rate = heat?.get(m.index);
          const now = active && m.index === focusMeasure;
          return (
            <div
              key={m.index}
              aria-hidden
              className={cn(
                'pointer-events-none absolute rounded-md transition-colors duration-[var(--dur-fast)]',
                now ? 'bg-primary/[0.08]' : inRange ? 'bg-transparent' : 'bg-foreground/[0.035]',
                rate !== undefined &&
                  rate > 0 &&
                  (rate >= 0.25 ? 'bg-mark-extra/15' : 'bg-warning/20'),
              )}
              style={{ left: m.x, top: m.y, width: m.w, height: m.h }}
            />
          );
        })}
        {active && cursor && (
          <div
            aria-hidden
            data-testid="score-cursor"
            className="pointer-events-none absolute rounded-full bg-primary/20 ring-1 ring-primary/50 transition-[left,top,width,height] duration-100 ease-out"
            style={{ left: cursor.x, top: cursor.y, width: cursor.w, height: cursor.h }}
          />
        )}
        <div ref={canvas} className="mc-score relative" />
        {layout &&
          chords?.map((c, i) => {
            const box = layout.measures.find((m) => m.index === c.measure);
            const m = score.measures[c.measure];
            if (!box || !m) return null;
            // 与前一个相同、又在同一小节里的不重复标
            const prev = chords[i - 1];
            if (prev && prev.measure === c.measure && prev.text === c.text) return null;
            const x =
              layout.tickX.get(c.start) ??
              box.noteX + ((c.start - m.start) / m.length) * (box.x + box.w - box.noteX);
            return (
              <span
                key={`${c.measure}:${c.start}`}
                className="pointer-events-none absolute -translate-y-full text-primary"
                style={{ left: x, top: box.labelY }}
                data-testid="chord-label"
              >
                <ChordName symbol={c.symbol} size="sm" />
              </span>
            );
          })}
      </div>
      {!layout && (
        <div className="grid h-40 place-items-center text-sm text-muted-foreground">
          {failed ? t('chords.staffError') : t('practice.loading')}
        </div>
      )}
    </div>
  );
}
