import { Check, Headphones, Hourglass, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { quarterBeatsPerBar } from '@/audio/rhythm-play';
import { FOCUS_BODY, FOCUS_CUE, FOCUS_KEYS, FOCUS_PAGE } from '@/design/focus-layout';
import { RhythmStaff } from '@/design/staff/StaffLine';
import { Button } from '@/design/ui/button';
import { MidiConnectButton } from '@/features/midi/MidiDevicePanel';
import { PlayableKeyboard } from '@/input/PlayableKeyboard';
import { cn } from '@/lib/utils';
import { rhythmSession, useRhythmSession } from './rhythm';

/**
 * 节奏读谱的练习界面（M10，专注模式）：一小节节奏 + 节拍点 + 每个起点的结果。
 * 在任意键上按：MIDI 键盘、屏幕键盘、电脑键盘都可以。
 */
export function RhythmRunner({ title }: { title?: ReactNode }) {
  const { t } = useTranslation();
  const v = useRhythmSession((s) => s);
  if (v.status !== 'running' || !v.rhythm) return null;
  const { rhythm, judge } = v;
  const beatsPerBar = quarterBeatsPerBar(rhythm.time);
  const target = v.spec?.targetCorrect;
  const progress = target !== undefined ? Math.min(v.correctCount, target) : v.index;
  const progressMax = target ?? v.length;

  let status: ReactNode;
  switch (v.phase) {
    case 'ready':
      status = (
        <>
          <Hourglass className="size-5" aria-hidden />
          {t('reading.ready')}
        </>
      );
      break;
    case 'demo':
      status = (
        <>
          <Headphones className="size-5" aria-hidden />
          {t('reading.listen')}
        </>
      );
      break;
    case 'countIn':
      status = t('reading.countIn', { n: v.beat !== null && v.beat < 0 ? -v.beat : beatsPerBar });
      break;
    case 'playing':
      status = <span className="text-primary">{t('reading.play')}</span>;
      break;
    case 'judged':
      status = judge?.correct ? (
        <span className="flex items-center gap-2 text-mark-correct">
          <Check className="size-5" aria-hidden />
          {judge.clean ? t('reading.clean') : t('reading.correctOffBeat')}
        </span>
      ) : (
        <span className="flex items-center gap-2 text-mark-extra">
          <X className="size-5" aria-hidden />
          {t('reading.wrong', { missed: judge?.missed ?? 0, extra: judge?.extra.length ?? 0 })}
        </span>
      );
      break;
  }

  return (
    <div className={FOCUS_PAGE}>
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => rhythmSession.finish()}>
          <X />
          {t('practice.exit')}
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {title && <div className="truncate text-xs text-muted-foreground">{title}</div>}
          <div className="flex items-center gap-3">
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progressMax}
              aria-valuenow={progress}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-[var(--dur-base)]"
                style={{ width: `${(progress / Math.max(1, progressMax)) * 100}%` }}
              />
            </div>
            <span className="font-mono text-sm text-muted-foreground tabular-nums">
              {progress}/{progressMax}
            </span>
          </div>
        </div>
        <MidiConnectButton />
      </div>
      {v.saveError && (
        <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          {t('practice.saveError')}
        </p>
      )}

      <div className={FOCUS_BODY}>
        <div
          className={cn(FOCUS_CUE, 'gap-6')}
          data-testid="rhythm-card"
          data-rhythm-id={rhythm.id}
          data-phase={v.phase}
          data-start-t={v.grid?.startT}
          data-beat-ms={v.grid?.beatMs}
          data-onsets={rhythm.pattern.onsets.join(' ')}
        >
          <p className="font-mono text-sm text-muted-foreground tabular-nums">
            {t('reading.tempo', { bpm: rhythm.bpm, time: `${rhythm.time[0]}/${rhythm.time[1]}` })}
          </p>
          <RhythmStaff
            tokens={rhythm.pattern.tokens}
            time={rhythm.time}
            marks={v.marks}
            label={t('learn.rhythmDemoLabel', { notes: rhythm.notes })}
            className="w-full max-w-xl"
          />
          <div className="flex gap-3" aria-hidden>
            {Array.from({ length: beatsPerBar }, (_, i) => {
              const inBar =
                v.beat === null ? -1 : ((v.beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
              return (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: 固定的拍点
                  key={i}
                  className={cn(
                    'size-3 rounded-full border border-border-strong transition-colors duration-75',
                    i === inBar &&
                      (v.phase === 'countIn'
                        ? 'border-subtle-foreground bg-subtle-foreground'
                        : 'border-primary bg-primary'),
                  )}
                />
              );
            })}
          </div>
          <div
            role="status"
            aria-live="polite"
            className="flex min-h-8 items-center justify-center gap-2 text-center text-lg"
            data-testid="rhythm-status"
          >
            {status}
          </div>
          {v.phase === 'judged' && judge && (
            <ul className="flex flex-wrap justify-center gap-2 font-mono text-xs tabular-nums">
              {judge.hits.map((h, i) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: 起点按顺序
                  key={i}
                  className={cn(
                    'rounded-full px-2 py-0.5',
                    h.tap === null
                      ? 'bg-mark-extra/15 text-mark-extra'
                      : h.onBeat
                        ? 'bg-mark-correct/15 text-mark-correct'
                        : 'bg-warning/15 text-warning',
                  )}
                >
                  {h.offset === null
                    ? t('reading.missed')
                    : `${h.offset > 0 ? '+' : ''}${Math.round(h.offset)} ms`}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={cn(FOCUS_KEYS, '[--kb-max-h:24dvh]')}>
          <p className="text-center text-sm text-muted-foreground">{t('reading.tapHint')}</p>
          <PlayableKeyboard
            low={60}
            high={72}
            labels="c"
            showComputerHints
            className="mx-auto max-w-md"
            aria-label={t('reading.tapPad')}
          />
        </div>
      </div>
    </div>
  );
}
