import {
  type BeatGrid,
  beatPhase,
  type RunSpec,
  type StepResult,
  scheduleStep,
} from '@mayochord/core';
import type { TFunction } from 'i18next';
import { Check, CircleDashed, Square, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChordName } from '@/design/ChordName';
import type { KeyMark } from '@/design/keyboard/Keyboard';
import { Button } from '@/design/ui/button';
import { judgeMarks, keyboardRange, referenceMarks } from '@/features/chords/voicing-view';
import { MidiConnectButton } from '@/features/midi/MidiDevicePanel';
import { PlayableKeyboard } from '@/input/PlayableKeyboard';
import { cn } from '@/lib/utils';
import { progressionRun, useRun } from './run';
import type { RunSource } from './run-source';
import { VoiceLeading } from './VoiceLeading';

interface Position {
  /** 当前拍（预备拍为负数） */
  beat: number;
  inBar: number;
  /** 当前窗口所在的步；预备拍里为 -1 */
  k: number;
}

/** 每帧用 performance.now() 算出当前在哪一拍、哪一步（只在变化时更新界面） */
function usePosition(spec: RunSpec | null, grid: BeatGrid | null): Position {
  const [pos, setPos] = useState<Position>({ beat: -99, inBar: 0, k: -1 });
  const last = useRef(pos);
  useEffect(() => {
    if (!spec || !grid) return;
    let raf = 0;
    let k = 0;
    const frame = () => {
      const now = performance.now();
      const { beat, inBar } = beatPhase(grid, now);
      if (now < scheduleStep(spec, grid, 0).windowStart) k = -1;
      else {
        k = Math.max(0, k);
        while (scheduleStep(spec, grid, k + 1).windowStart <= now) k++;
      }
      const p = last.current;
      if (p.beat !== beat || p.k !== k) {
        last.current = { beat, inBar, k };
        setPos(last.current);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [spec, grid]);
  return pos;
}

export function offsetText(t: TFunction, r: StepResult) {
  if (r.status === 'missed') return t('progression.missed');
  if (r.status === 'wrong') return t('progression.wrong');
  const ms = r.beatOffsetMs ?? 0;
  if (r.onBeat) return t('progression.onBeat', { ms: ms > 0 ? `+${ms}` : ms });
  return ms < 0 ? t('progression.early', { ms: -ms }) : t('progression.late', { ms });
}

/**
 * 跟拍弹进行的界面（专注模式）：预备拍倒数、拍点指示、大字当前和弦与下一个和弦、
 * 每一步是否弹对、是否在拍上，声部进行与键位（可隐藏）。自由练习和课程共用。
 */
export function ProgressionRunner({ source, title }: { source: RunSource; title?: ReactNode }) {
  const { t } = useTranslation();
  const config = useRun((v) => v.config);
  const grid = useRun((v) => v.grid);
  const results = useRun((v) => v.results);
  const partial = useRun((v) => v.partial);
  const spec = config?.spec ?? null;
  const pos = usePosition(spec, grid);
  const n = source.steps.length;
  const range = useMemo(
    () =>
      keyboardRange(
        source.steps.flatMap((s) => s.chord.notes.map((x) => x.midi)),
        3,
      ),
    [source],
  );
  if (!spec || !grid || !config) return null;

  const countIn = pos.k < 0;
  const k = Math.max(0, pos.k);
  const step = source.steps[k % n];
  const next = source.steps[(k + 1) % n];
  const total = spec.loops === null ? null : spec.loops * n;
  const isLast = total !== null && k + 1 >= total;
  const loop = Math.floor(k / n);
  const result: StepResult | undefined = results[k];
  const prevResult: StepResult | undefined = results[k - 1];
  const showHints = spec.hintsVisible;
  if (!step || !next) return null;

  // 键盘：显示键位时标出当前和弦；弹错时标出多按/少按
  let marks: Map<number, KeyMark> | undefined;
  const voicing = {
    id: '',
    chordId: step.chord.id,
    notes: [...step.chord.notes],
    status: 'generated' as const,
  };
  if (result?.status === 'wrong' && result.judge && result.notes) {
    marks = judgeMarks(voicing, result.notes, result.judge);
  } else if (showHints && !countIn) {
    marks = referenceMarks(voicing);
  } else if (showHints && countIn) {
    const first = source.steps[0];
    if (first) marks = referenceMarks({ ...voicing, notes: [...first.chord.notes] });
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => progressionRun.stop()}
          title={t('progression.stopLabel')}
        >
          <Square className="size-3.5" />
          {t('progression.stop')}
        </Button>
        <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{title}</div>
        <span className="font-mono text-sm text-muted-foreground tabular-nums">
          {t('progression.bpmShort', { bpm: spec.bpm })}
          {total !== null &&
            !countIn &&
            ` · ${t('progression.loopOf', { i: loop + 1, n: spec.loops ?? 0 })}`}
        </span>
        <MidiConnectButton />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-6">
        <BeatDots beatsPerBar={spec.beatsPerBar} inBar={pos.inBar} beat={pos.beat} />

        {countIn ? (
          <div className="flex flex-col items-center gap-3" data-testid="count-in">
            <span className="text-sm text-muted-foreground">{t('progression.countIn')}</span>
            <span className="font-display-chord text-[length:var(--text-chord-lg)] leading-none tabular-nums text-primary">
              {Math.max(1, -pos.beat)}
            </span>
            <span className="flex items-baseline gap-2 text-muted-foreground">
              {t('progression.firstChord')}
              <ChordName symbol={(source.steps[0] ?? step).chord.symbol} size="md" />
            </span>
          </div>
        ) : (
          <div
            className="flex items-end gap-8 sm:gap-14"
            data-testid="run-step"
            data-k={k}
            data-step-t={scheduleStep(spec, grid, k).t}
            data-status={result?.status ?? 'pending'}
          >
            <div className="flex flex-col items-center gap-3">
              <ChordName symbol={step.chord.symbol} size="stage" />
              <StepChip result={result} partial={partial !== null && !result} />
            </div>
            {!isLast && (
              <div className="flex flex-col items-center gap-2 pb-12 text-muted-foreground">
                <span className="text-xs tracking-wide">{t('progression.next')}</span>
                <ChordName symbol={next.chord.symbol} size="md" />
              </div>
            )}
          </div>
        )}

        <LoopStrip n={n} loop={countIn ? 0 : loop} results={results} current={countIn ? -1 : k} />
        {prevResult && !countIn && (
          <span className="sr-only" aria-live="polite">
            {offsetText(t, prevResult)}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {showHints && !countIn && !isLast && (
          <div className="mx-auto max-w-4xl overflow-x-auto">
            <VoiceLeading
              from={step.chord.notes}
              to={next.chord.notes}
              low={range.low}
              high={range.high}
              className="min-w-[440px]"
            />
          </div>
        )}
        <div className="mx-auto max-w-4xl overflow-x-auto">
          <PlayableKeyboard
            low={range.low}
            high={range.high}
            labels="c"
            className="min-w-[440px]"
            {...(marks ? { marks } : {})}
          />
        </div>
      </div>
    </div>
  );
}

function BeatDots({
  beatsPerBar,
  inBar,
  beat,
}: {
  beatsPerBar: number;
  inBar: number;
  beat: number;
}) {
  return (
    <div className="flex gap-3" aria-hidden data-testid="beat-dots">
      {Array.from({ length: beatsPerBar }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: 固定的拍点
          key={i}
          className={cn(
            'size-3 rounded-full border border-border-strong transition-colors duration-75',
            beat > -99 &&
              i === inBar &&
              (i === 0 ? 'border-primary bg-primary' : 'border-foreground bg-foreground'),
          )}
        />
      ))}
    </div>
  );
}

function StepChip({ result, partial }: { result: StepResult | undefined; partial: boolean }) {
  const { t } = useTranslation();
  if (!result) {
    return (
      <span className="flex h-7 items-center gap-1.5 text-sm text-subtle-foreground">
        {partial && (
          <>
            <CircleDashed className="size-4" aria-hidden />
            {t('progression.partial')}
          </>
        )}
      </span>
    );
  }
  const ok = result.status === 'correct';
  const clean = ok && result.onBeat && result.together !== false;
  return (
    <span
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-full border px-3 text-sm font-medium tabular-nums',
        clean
          ? 'border-mark-correct/50 bg-mark-correct/10 text-mark-correct'
          : ok
            ? 'border-warning/50 bg-warning/10 text-warning'
            : 'border-mark-extra/50 bg-mark-extra/10 text-mark-extra',
      )}
      data-testid="step-chip"
    >
      {ok ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
      {offsetText(t, result)}
      {ok && result.together === false && ` · ${t('progression.notTogether')}`}
    </span>
  );
}

/** 这一遍里每一步的结果 */
function LoopStrip({
  n,
  loop,
  results,
  current,
}: {
  n: number;
  loop: number;
  results: readonly StepResult[];
  current: number;
}) {
  return (
    <div className="flex gap-1.5" aria-hidden>
      {Array.from({ length: n }, (_, i) => {
        const k = loop * n + i;
        const r = results[k];
        const clean = r?.status === 'correct' && r.onBeat && r.together !== false;
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: 固定的步
            key={i}
            className={cn(
              'h-1.5 w-8 rounded-full bg-border',
              r &&
                (clean
                  ? 'bg-mark-correct'
                  : r.status === 'correct'
                    ? 'bg-warning'
                    : 'bg-mark-extra'),
              !r && k === current && 'bg-foreground/40',
            )}
          />
        );
      })}
    </div>
  );
}
