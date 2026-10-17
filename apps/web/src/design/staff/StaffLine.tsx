import type { RhythmToken } from '@mayochord/core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

type State = 'loading' | 'ready' | 'error';
/** 最多放大到自然大小的几倍（只有一两个音时不要撑满整行） */
const SCALE = 2;

function Placeholder({ state }: { state: State }) {
  const { t } = useTranslation();
  if (state === 'ready') return null;
  return (
    <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
      {state === 'loading' ? (
        <div className="h-full w-full animate-pulse rounded-md bg-surface-2/60" />
      ) : (
        t('chords.staffError')
      )}
    </div>
  );
}

export interface StaffLineProps {
  clef: 'treble' | 'bass' | 'grand';
  /** 调号（大调主音） */
  musicKey?: string | null;
  notes: readonly string[];
  labels?: boolean;
  label: string;
  className?: string;
}

/** 一行谱表（或大谱表）上的几个全音符：读谱课程的示范、看谱认音题。VexFlow 懒加载。 */
export function StaffLine({
  clef,
  musicKey = null,
  notes,
  labels = false,
  label,
  className,
}: StaffLineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>('loading');
  const [size, setSize] = useState({ aspect: clef === 'grand' ? 0.8 : 1.2, width: 200 });
  const notesKey = notes.join(' ');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    import('./render-staff')
      .then(async ({ renderStaffLine, staffFontsReady }) => {
        await staffFontsReady();
        if (cancelled || !ref.current) return;
        const r = renderStaffLine(ref.current, {
          clef,
          key: musicKey,
          notes: notesKey ? notesKey.split(' ') : [],
          labels,
        });
        setSize({ aspect: r.aspect, width: r.width });
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [clef, musicKey, notesKey, labels]);

  return (
    <div
      className={cn('relative', className)}
      style={{ aspectRatio: size.aspect, maxWidth: size.width * SCALE }}
      role="img"
      aria-label={label}
    >
      <div ref={ref} className="mc-staff text-foreground [&_svg]:h-auto [&_svg]:w-full" />
      <Placeholder state={state} />
    </div>
  );
}

export type OnsetMark = 'current' | 'ok' | 'off' | 'missed' | null;

export interface RhythmStaffProps {
  tokens: readonly RhythmToken[];
  time: readonly [number, number];
  /** 每个要按的起点的标记（按起点顺序） */
  marks?: readonly OnsetMark[];
  label: string;
  className?: string;
}

/** 一小节节奏（节奏读谱）。起点的音符按 marks 着色：当前 / 在拍上 / 不在拍上 / 漏了。 */
export function RhythmStaff({ tokens, time, marks, label, className }: RhythmStaffProps) {
  const ref = useRef<HTMLDivElement>(null);
  const els = useRef<SVGElement[]>([]);
  const [state, setState] = useState<State>('loading');
  const [size, setSize] = useState({ aspect: 2.6, width: 320 });
  const key = JSON.stringify([tokens, time]);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    const [tk, tm] = JSON.parse(key) as [RhythmToken[], [number, number]];
    import('./render-staff')
      .then(async ({ renderRhythm, staffFontsReady }) => {
        await staffFontsReady();
        if (cancelled || !ref.current) return;
        const r = renderRhythm(ref.current, tk, tm);
        els.current = r.onsetEls;
        setSize({ aspect: r.aspect, width: r.width });
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  // 只改 class，不重新排版
  useEffect(() => {
    if (state !== 'ready') return;
    els.current.forEach((el, i) => {
      const m = marks?.[i] ?? null;
      el.setAttribute('data-mark', m ?? '');
    });
  }, [marks, state]);

  return (
    <div
      className={cn('relative', className)}
      style={{ aspectRatio: size.aspect, maxWidth: size.width * SCALE }}
      role="img"
      aria-label={label}
    >
      <div ref={ref} className="mc-staff mc-rhythm text-foreground [&_svg]:h-auto [&_svg]:w-full" />
      <Placeholder state={state} />
    </div>
  );
}
