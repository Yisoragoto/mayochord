import type { ChordEntry } from '@mayochord/content';
import {
  type ChordAttempt,
  findUniformShift,
  type JudgeMode,
  type JudgeResult,
  judgeNotes,
  midiToName,
  prettyAccidentals,
  voicingMidi,
} from '@mayochord/core';
import { Check, CircleDashed, TriangleAlert, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/design/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/design/ui/toggle-group';
import { MidiConnectButton } from '@/features/midi/MidiDevicePanel';
import { sourceKind } from '@/input/hub';
import { liveInput, useLiveInput } from '@/input/live';
import { PlayableKeyboard, releaseOnscreenNotes } from '@/input/PlayableKeyboard';
import { cn } from '@/lib/utils';
import { useSettings } from '@/stores/settings';
import { judgeMarks, keyboardRange } from './voicing-view';

interface TrialResult {
  id: number;
  attempt: ChordAttempt;
  judge: JudgeResult;
  /** 整体平移了多少半音（OCTAVE/TRANSPOSE 被改动的迹象） */
  shift: number | null;
  /** 这次新按下的音是否全部来自 MIDI 键盘（屏幕键盘、电脑键盘的齐整度没有意义） */
  fromMidi: boolean;
}

const names = (notes: readonly number[]) =>
  notes.map((n) => prettyAccidentals(midiToName(n))).join(' ');

export function TrialPanel({ chord }: { chord: ChordEntry }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<JudgeMode>('loose');
  const [result, setResult] = useState<TrialResult | null>(null);
  const settings = useSettings((s) => s.settings);
  const target = useMemo(() => voicingMidi(chord.reference), [chord]);
  const range = useMemo(() => keyboardRange(target, 6), [target]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 换和弦或换模式时清除上一次结果
  useEffect(() => setResult(null), [chord.id, mode]);

  useEffect(
    () =>
      liveInput.onAttempt((attempt) => {
        const judge = judgeNotes(attempt.notes, target, mode);
        const notes = useLiveInput.getState().notes;
        setResult((prev) => ({
          id: (prev?.id ?? 0) + 1,
          attempt,
          judge,
          shift: judge.correct ? null : findUniformShift(attempt.notes, target),
          fromMidi: attempt.newNotes.every(
            (n) => sourceKind(notes.get(n)?.source ?? '') === 'midi',
          ),
        }));
      }),
    [target, mode],
  );

  const marks = result
    ? judgeMarks(chord.reference, result.attempt.notes, result.judge)
    : undefined;

  let status: ReactNode;
  let tone: 'idle' | 'ok' | 'bad' | 'warn' = 'idle';
  if (!result) {
    status = (
      <>
        <CircleDashed className="size-5" aria-hidden />
        {t('chords.waiting')}
      </>
    );
  } else if (result.shift !== null) {
    tone = 'warn';
    const abs = Math.abs(result.shift);
    const amount =
      abs % 12 === 0
        ? t('chords.octaves', { count: abs / 12 })
        : t('chords.semitones', { count: abs });
    status = (
      <>
        <TriangleAlert className="size-5 shrink-0" aria-hidden />
        {result.shift > 0 ? t('chords.shiftedUp', { amount }) : t('chords.shiftedDown', { amount })}
      </>
    );
  } else if (result.judge.correct) {
    tone = result.fromMidi && !result.attempt.together ? 'warn' : 'ok';
    status = (
      <>
        <Check className="size-5 shrink-0" aria-hidden />
        <span className="font-semibold">{t('chords.correct')}</span>
        <span className="text-muted-foreground">
          {result.fromMidi
            ? result.attempt.together
              ? t('chords.spread', { ms: Math.round(result.attempt.spreadMs) })
              : t('chords.notTogether', { ms: Math.round(result.attempt.spreadMs) })
            : t('chords.spreadNoMidi')}
        </span>
      </>
    );
  } else {
    tone = 'bad';
    status = (
      <>
        <X className="size-5 shrink-0" aria-hidden />
        <span className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
          {result.judge.missing.length > 0 && (
            <span>{t('chords.missing', { notes: names(result.judge.missing) })}</span>
          )}
          {result.judge.extra.length > 0 && (
            <span>{t('chords.extra', { notes: names(result.judge.extra) })}</span>
          )}
        </span>
      </>
    );
  }

  return (
    <section
      aria-labelledby="trial-title"
      className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="trial-title" className="mr-auto text-lg font-semibold">
          {t('chords.trialTitle')}
        </h2>
        <MidiConnectButton />
        <ToggleGroup
          type="single"
          size="sm"
          value={mode}
          onValueChange={(v) => v && setMode(v as JudgeMode)}
          aria-label={t('chords.mode')}
          className="rounded-md border border-border p-0.5"
        >
          <ToggleGroupItem value="loose" className="px-3">
            {t('chords.modeLoose')}
          </ToggleGroupItem>
          <ToggleGroupItem value="strict" className="px-3">
            {t('chords.modeStrict')}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <p className="text-sm text-muted-foreground">
        {t('chords.trialHint', { window: settings.onsetWindowMs, stable: settings.stableMs })}
      </p>

      <div
        className={cn(
          'flex min-h-14 items-center gap-2 rounded-lg border px-4 py-3 text-sm transition-colors duration-[var(--dur-fast)]',
          tone === 'idle' && 'border-dashed border-border-strong text-muted-foreground',
          tone === 'ok' && 'border-mark-correct/50 bg-mark-correct/10 text-mark-correct',
          tone === 'bad' && 'border-mark-extra/50 bg-mark-extra/10 text-mark-extra',
          tone === 'warn' && 'border-warning/50 bg-warning/10 text-warning',
        )}
        role="status"
        aria-live="polite"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={result?.id ?? 0}
            className="flex flex-wrap items-center gap-2"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={
              reduce
                ? { opacity: 1 }
                : tone === 'bad'
                  ? { opacity: 1, y: 0, x: [0, -6, 5, -3, 0] }
                  : { opacity: 1, y: 0 }
            }
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
          >
            {status}
          </motion.span>
        </AnimatePresence>
      </div>

      <div className="mx-auto max-w-4xl overflow-x-auto">
        <PlayableKeyboard
          low={range.low}
          high={range.high}
          labels="c"
          showComputerHints
          className="min-w-[440px]"
          {...(marks ? { marks } : {})}
        />
      </div>

      {settings.onscreenMode === 'latch' && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>{t('chords.onscreenLatchHint')}</span>
          <Button size="sm" variant="outline" onClick={() => releaseOnscreenNotes()}>
            {t('chords.clearOnscreen')}
          </Button>
        </div>
      )}
    </section>
  );
}
