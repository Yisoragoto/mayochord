import { type ChordLabel, type FollowPlan, type Hand, type Score, TPQ } from '@mayochord/core';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { KEYBOARD_GEOMETRY, keyboardLayout } from '@/design/keyboard/Keyboard';
import { cn } from '@/lib/utils';
import { scorePlayer } from './player';
import { playheadTick } from './score-player';

export interface WaterfallViewProps {
  score: Score;
  /** 要画的这一段（按演奏顺序，反复记号已展开）；弹奏时与控制器的 plan 相同 */
  plan: FollowPlan;
  low: number;
  high: number;
  /** 自己弹的手；另一只手的音画得淡一些 */
  hands: 'both' | Hand;
  /** 自动标出的和弦（画在小节线右边）；不显示为 null */
  chords?: readonly ChordLabel[] | null;
  className?: string;
}

/** 画面里能看到多少个四分音符 */
const WINDOW_BEATS = 8;

interface Colors {
  left: string;
  right: string;
  ok: string;
  bad: string;
  line: string;
  text: string;
  now: string;
}

function readColors(el: Element): Colors {
  const s = getComputedStyle(el);
  const v = (name: string) => s.getPropertyValue(name).trim() || '#888';
  return {
    left: v('--hand-left'),
    right: v('--hand-right'),
    ok: v('--mark-correct'),
    bad: v('--mark-extra'),
    line: v('--border'),
    text: v('--subtle-foreground'),
    now: v('--primary'),
  };
}

/**
 * 瀑布流：音块从上往下落到键盘上（下边缘 = 现在）。与下方同样 low/high 的键盘左右对齐。
 * 每一帧直接读控制器的状态，不经过 React 重新渲染。
 */
export function WaterfallView({
  score,
  plan,
  low,
  high,
  hands,
  chords,
  className,
}: WaterfallViewProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLCanvasElement>(null);
  const layout = useMemo(() => keyboardLayout(low, high), [low, high]);
  const keyX = useMemo(() => new Map(layout.keys.map((k) => [k.note, k])), [layout]);
  const maxDur = useMemo(() => Math.max(TPQ, ...score.notes.map((n) => n.dur)), [score]);
  /** 这一段里的音块，按开始时间排序：[开始 tick, 音] */
  const blocks = useMemo(
    () => plan.steps.flatMap((st) => [...st.notes, ...st.auto].map((n) => [st.tick, n] as const)),
    [plan],
  );

  /** 和弦名在这一段演奏时间轴上的位置：[tick, 文字]，相邻相同的只标一次 */
  const chordMarks = useMemo(() => {
    if (!chords) return [];
    const out: [number, string][] = [];
    for (const seg of plan.segments) {
      const m = score.measures[seg.measure];
      if (!m) continue;
      for (const c of chords) {
        if (c.measure !== seg.measure) continue;
        if (out[out.length - 1]?.[1] === c.text) continue;
        out.push([seg.start + c.start - m.start, c.text]);
      }
    }
    return out;
  }, [chords, plan, score]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let colors = readColors(canvas);
    const themeObserver = new MutationObserver(() => {
      colors = readColors(canvas);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    let raf = 0;
    let shown = plan.start;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const view = scorePlayer.view;
      const target = playheadTick(view, performance.now()) ?? plan.start;
      // 等待模式下平滑地移到下一组；跳回开头（循环）时直接跳
      if (view.clock || Math.abs(target - shown) > TPQ * 16 || target < shown) shown = target;
      else shown += (target - shown) * 0.25;
      const tick = shown;
      const pxPerTick = h / (TPQ * WINDOW_BEATS);
      const scale = w / layout.width;
      const yOf = (tk: number) => h - (tk - tick) * pxPerTick;

      const hi = tick + TPQ * WINDOW_BEATS;
      // 循环时把下一遍的开头也画出来
      const offsets = plan.length > 0 ? [0, plan.length] : [0];

      // 小节线与小节号
      ctx.font = '11px ui-monospace, monospace';
      ctx.textBaseline = 'bottom';
      for (const off of offsets) {
        for (const seg of plan.segments) {
          const start = seg.start + off;
          if (start > hi) break;
          const m = score.measures[seg.measure];
          if (!m || start + m.length < tick) continue;
          const y = Math.round(yOf(start)) + 0.5;
          ctx.strokeStyle = colors.line;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
          ctx.fillStyle = colors.text;
          ctx.fillText(m.number, 4, y - 2);
        }
      }

      // 和弦名
      ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = colors.now;
      for (const off of offsets) {
        for (const [ct, text] of chordMarks) {
          const at = ct + off;
          if (at > hi) break;
          if (at < tick - TPQ) continue;
          ctx.fillText(text, w - 6, Math.round(yOf(at)) - 3);
        }
      }
      ctx.textAlign = 'left';

      // 音块
      const marks = view.marks;
      const lo = tick - maxDur;
      for (const off of offsets) {
        for (const [st, n] of blocks) {
          const start = st + off;
          if (start > hi) break;
          if (start < lo || start + n.dur < tick) continue;
          const key = keyX.get(n.pitch);
          if (!key) continue;
          const kw = key.black ? KEYBOARD_GEOMETRY.blackWidth : KEYBOARD_GEOMETRY.whiteWidth;
          const x = key.x * scale + 1.5;
          const bw = kw * scale - 3;
          const y1 = yOf(start);
          const y0 = yOf(start + n.dur);
          const mine = hands === 'both' || hands === n.hand;
          const mark = off === 0 ? marks.get(n.id) : undefined;
          ctx.globalAlpha = mine ? 1 : 0.35;
          ctx.fillStyle =
            mark === 'ok'
              ? colors.ok
              : mark === 'bad'
                ? colors.bad
                : n.hand === 'left'
                  ? colors.left
                  : colors.right;
          const top = Math.max(-4, y0 + 1);
          const height = Math.max(3, y1 - top - 1);
          ctx.beginPath();
          ctx.roundRect(x, top, bw, height, 3);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // "现在"线
      ctx.fillStyle = colors.now;
      ctx.fillRect(0, h - 2, w, 2);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      themeObserver.disconnect();
    };
  }, [score, plan, blocks, chordMarks, layout, keyX, maxDur, hands]);

  return (
    <canvas
      ref={ref}
      className={cn('block w-full rounded-t-xl bg-card', className)}
      role="img"
      aria-label={t('scores.waterfallLabel')}
      data-testid="waterfall-view"
    />
  );
}
