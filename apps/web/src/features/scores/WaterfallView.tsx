import { type Hand, type Score, TPQ } from '@mayochord/core';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { KEYBOARD_GEOMETRY, keyboardLayout } from '@/design/keyboard/Keyboard';
import { cn } from '@/lib/utils';
import { scorePlayer } from './player';
import { playheadTick } from './score-player';

export interface WaterfallViewProps {
  score: Score;
  low: number;
  high: number;
  /** 自己弹的手；另一只手的音画得淡一些 */
  hands: 'both' | Hand;
  from: number;
  to: number;
  /** 不在弹奏时停在这里（tick） */
  restTick: number;
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
  low,
  high,
  hands,
  from,
  to,
  restTick,
  className,
}: WaterfallViewProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLCanvasElement>(null);
  const layout = useMemo(() => keyboardLayout(low, high), [low, high]);
  const keyX = useMemo(() => new Map(layout.keys.map((k) => [k.note, k])), [layout]);
  const maxDur = useMemo(() => Math.max(TPQ, ...score.notes.map((n) => n.dur)), [score]);

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
    let shown = restTick;
    const notes = score.notes;
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
      const target = playheadTick(view, performance.now()) ?? restTick;
      // 等待模式下平滑地移到下一组；跳回开头（循环）时直接跳
      if (view.clock || Math.abs(target - shown) > TPQ * 16 || target < shown) shown = target;
      else shown += (target - shown) * 0.25;
      const tick = shown;
      const pxPerTick = h / (TPQ * WINDOW_BEATS);
      const scale = w / layout.width;
      const yOf = (tk: number) => h - (tk - tick) * pxPerTick;

      // 小节线与小节号
      ctx.font = '11px ui-monospace, monospace';
      ctx.textBaseline = 'bottom';
      for (const m of score.measures) {
        if (m.start > tick + TPQ * WINDOW_BEATS) break;
        if (m.start + m.length < tick) continue;
        const y = Math.round(yOf(m.start)) + 0.5;
        ctx.strokeStyle = colors.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.fillStyle = colors.text;
        ctx.fillText(m.number, 4, y - 2);
      }

      // 音块
      const marks = view.marks;
      const lo = tick - maxDur;
      const hi = tick + TPQ * WINDOW_BEATS;
      for (const n of notes) {
        if (n.start > hi) break;
        if (n.start < lo || n.start + n.dur < tick) continue;
        const key = keyX.get(n.pitch);
        if (!key) continue;
        const kw = key.black ? KEYBOARD_GEOMETRY.blackWidth : KEYBOARD_GEOMETRY.whiteWidth;
        const x = key.x * scale + 1.5;
        const bw = kw * scale - 3;
        const y1 = yOf(n.start);
        const y0 = yOf(n.start + n.dur);
        const mine = hands === 'both' || hands === n.hand;
        const inRange = n.measure >= from && n.measure <= to;
        const mark = marks.get(n.id);
        ctx.globalAlpha = !inRange ? 0.15 : mine ? 1 : 0.35;
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
  }, [score, layout, keyX, maxDur, hands, from, to, restTick]);

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
