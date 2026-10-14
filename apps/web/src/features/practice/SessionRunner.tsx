import { type AnyCard, midiToName, prettyAccidentals, type TrialState } from '@mayochord/core';
import {
  ArrowRight,
  Check,
  CircleDashed,
  Flame,
  Lightbulb,
  SkipForward,
  TriangleAlert,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChordName } from '@/design/ChordName';
import type { KeyMark } from '@/design/keyboard/Keyboard';
import { Button } from '@/design/ui/button';
import { judgeMarks, referenceMarks } from '@/features/chords/voicing-view';
import { MidiConnectButton } from '@/features/midi/MidiDevicePanel';
import { useLiveInput } from '@/input/live';
import { PlayableKeyboard, releaseOnscreenNotes } from '@/input/PlayableKeyboard';
import { useMidi } from '@/input/webmidi';
import { cn } from '@/lib/utils';
import { useSettings } from '@/stores/settings';
import { cardsRange, chordLabel, chordOf, fromVoicing, targetVoicing } from './cards-view';
import type { PracticeView } from './controller';
import { practice, usePractice } from './practice';

const noteNames = (notes: readonly number[]) =>
  notes.map((n) => prettyAccidentals(midiToName(n))).join(' ');

export const seconds = (ms: number) => (ms / 1000).toFixed(ms < 10_000 ? 2 : 1);

export function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">{children}</div>
    </div>
  );
}

export interface SessionRunnerProps {
  /** 顶栏左侧的标题（例如"引导练习 · 大三和弦公式"） */
  title?: ReactNode;
}

/**
 * 专注模式的练习界面（规格 5.2）：隐藏导航，只保留题目、键盘和进度。
 * 自由练习、课程各阶段、每日任务共用；由 practice 控制器驱动。
 */
export function SessionRunner({ title }: SessionRunnerProps) {
  const { t } = useTranslation();
  const view = usePractice((v) => v);
  const latch = useSettings((s) => s.settings.onscreenMode === 'latch');
  const midiConnected = useMidi((s) => s.status === 'ready' && s.selectedInputId !== null);
  const trial = view.trial;
  const cards = view.spec?.cards;
  const range = useMemo(() => cardsRange(cards ?? []), [cards]);

  if (!trial || !view.spec) return null;
  const spec = view.spec;
  const done = view.index - 1 + (trial.status === 'done' ? 1 : 0);
  const target = spec.targetCorrect;
  const progress = target !== undefined ? Math.min(view.correctCount, target) : done;
  const progressMax = target ?? view.length;
  const judged = trial.status === 'retry' || trial.status === 'done';
  // 反馈逐渐减少：熟练的卡判定前不显示按下的键；很熟练且连着 MIDI 时连键盘也先收起
  const hidePressed = view.feedback !== 'full' && !judged && !trial.hintVisible;
  const collapseKeyboard =
    view.feedback === 'minimal' && midiConnected && !judged && !trial.hintVisible;

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
      {/* 顶栏：结束、进度、连对 */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => practice.finish()}
          aria-label={t('practice.exitLabel')}
          title={t('practice.exitLabel')}
        >
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
              aria-label={
                target !== undefined
                  ? t('practice.correctProgress', { i: progress, n: target })
                  : t('practice.progress', { i: view.index, n: view.length })
              }
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-[var(--dur-base)]"
                style={{ width: `${(progress / Math.max(1, progressMax)) * 100}%` }}
              />
            </div>
            <span className="font-mono text-sm text-muted-foreground tabular-nums">
              {target !== undefined ? (
                <>
                  <Check className="mr-0.5 inline size-3.5 align-[-2px]" aria-hidden />
                  {progress}/{target}
                </>
              ) : (
                `${view.index}/${view.length}`
              )}
            </span>
          </div>
        </div>
        <MidiConnectButton />
        <Streak n={view.streak} />
      </div>

      {view.saveError && (
        <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          {t('practice.saveError')}
        </p>
      )}

      {/* 题目 */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-6">
        <ReasonLabel view={view} />
        <Cue view={view} />
        <TimeBar trial={trial} hidden={spec.hints === 'always'} />
        <Feedback view={view} />
        <ShortTapNotice active={trial.status !== 'done'} />
      </div>

      {/* 键盘与操作 */}
      <div className="space-y-3">
        {collapseKeyboard ? (
          <p className="text-center text-sm text-subtle-foreground">
            {t('practice.keyboardHidden')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <PlayableKeyboard
              low={range.low}
              high={range.high}
              labels="c"
              showComputerHints
              hidePressed={hidePressed}
              className="mx-auto max-w-5xl sm:min-w-[520px]"
              aria-label={t('chords.trialTitle')}
              {...marksFor(trial)}
            />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {spec.hints !== 'never' && (
            <Button
              variant="outline"
              onClick={() => practice.hint()}
              disabled={
                !(
                  (trial.status === 'awaiting' && !trial.hintVisible) ||
                  (trial.status === 'setup' && !trial.setupHintVisible)
                )
              }
            >
              <Lightbulb />
              {t('practice.hint')}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => practice.skip()}
            disabled={trial.status === 'done'}
          >
            <SkipForward />
            {t('practice.skip')}
          </Button>
          {latch && (
            <Button variant="ghost" onClick={() => releaseOnscreenNotes()}>
              {t('practice.clearOnscreen')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function marksFor(state: TrialState): { marks?: ReadonlyMap<number, KeyMark> } {
  const target = targetVoicing(state.trial.card);
  const from = fromVoicing(state.trial);
  const fb = state.feedback;
  if (state.status === 'setup' && from) {
    if (fb?.stage === 'from' && !fb.judge.correct) {
      return { marks: judgeMarks(from, fb.attempt.notes, fb.judge) };
    }
    return state.setupHintVisible ? { marks: referenceMarks(from) } : {};
  }
  if (!target) return {};
  const marks = state.hintVisible ? referenceMarks(target) : new Map<number, KeyMark>();
  if (fb?.stage === 'target' && (state.status === 'retry' || state.status === 'done')) {
    for (const [n, m] of judgeMarks(target, fb.attempt.notes, fb.judge)) marks.set(n, m);
  }
  return marks.size > 0 ? { marks } : {};
}

function Streak({ n }: { n: number }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  return (
    <div className="min-w-20 text-right" aria-live="polite">
      <AnimatePresence initial={false}>
        {n >= 2 && (
          <motion.span
            key={n}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 font-mono text-sm text-primary tabular-nums"
          >
            <Flame className="size-4" aria-hidden />
            {t('practice.streak', { n })}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReasonLabel({ view }: { view: PracticeView }) {
  const { t } = useTranslation();
  const key = {
    focus: 'practice.reasonFocus',
    ordered: 'practice.reasonOrdered',
    mixed: 'practice.reasonMixed',
    retry: 'practice.reasonRetry',
  } as const;
  const hideReason = view.spec?.kind === 'mastery' || view.spec?.kind === 'guided';
  return (
    <p className="font-mono text-xs tracking-[0.2em] text-subtle-foreground uppercase">
      {view.reason && !hideReason ? t(key[view.reason]) : ' '}
    </p>
  );
}

/** 题面：和弦名 / "从 → 到" / 音名 / 音程（谱架 1 米外可读） */
function CardFace({ card, size }: { card: AnyCard; size: 'stage' | 'lg' }) {
  const { t } = useTranslation();
  switch (card.kind) {
    case 'chord':
    case 'transition': {
      const chord = chordOf(card.kind === 'chord' ? card.chordId : card.toChordId);
      return chord ? <ChordName symbol={chord.symbol} size={size} /> : null;
    }
    case 'note':
      return (
        <span className="flex flex-col items-center gap-3">
          <span className="font-display-chord text-[length:var(--text-chord-stage)] leading-none">
            {prettyAccidentals(card.note)}
          </span>
          <span className="text-sm text-muted-foreground">{t('practice.noteCaption')}</span>
        </span>
      );
    case 'interval':
      return (
        <span className="flex flex-col items-center gap-3">
          <span className="flex items-baseline gap-4">
            <span className="font-display-chord text-[length:var(--text-chord-stage)] leading-none">
              {prettyAccidentals(card.root)}
            </span>
            <span className="font-cjk-heading text-[length:var(--text-chord-lg)] leading-none font-semibold">
              ↑ {t(`practice.intervals.${card.interval}`)}
            </span>
          </span>
          <span className="text-sm text-muted-foreground">{t('practice.intervalCaption')}</span>
        </span>
      );
  }
}

function Cue({ view }: { view: PracticeView }) {
  const reduce = useReducedMotion();
  const state = view.trial as TrialState;
  const card = state.trial.card;
  const from = chordOf(state.trial.fromChordId);
  const result = view.result;
  /** 切换题还没弹稳"从"和弦时，目标和弦先淡显 */
  const dim = state.status === 'setup' ? 0.35 : 1;
  const tone =
    state.status === 'done' && result?.correct
      ? 'text-mark-correct'
      : state.status === 'retry'
        ? 'text-mark-extra'
        : 'text-foreground';

  return (
    <div
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:gap-x-8"
      data-testid="practice-cue"
      data-card-id={card.id}
      data-chord-id={state.trial.targetChordId}
      data-from-chord-id={state.trial.fromChordId ?? undefined}
      data-trial-status={state.status}
    >
      {from && (
        <>
          <span
            className={cn(
              'transition-colors duration-[var(--dur-base)]',
              state.status === 'setup' ? 'text-foreground' : 'text-subtle-foreground',
            )}
          >
            <ChordName symbol={from.symbol} size="lg" />
          </span>
          <ArrowRight
            className={cn(
              'size-8 shrink-0 sm:size-12',
              state.status === 'setup' ? 'text-subtle-foreground' : 'text-primary',
            )}
            aria-hidden
          />
        </>
      )}
      <motion.span
        key={`${state.trial.id}-${result?.trialId ?? ''}`}
        className={cn('transition-colors duration-[var(--dur-base)]', tone)}
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={
          reduce
            ? { opacity: dim }
            : result && !result.correct
              ? { opacity: dim, y: 0, x: [0, -12, 9, -5, 0] }
              : result?.correct
                ? { opacity: dim, y: 0, scale: [1, 1.06, 1] }
                : { opacity: dim, y: 0 }
        }
        transition={{ duration: 0.28 }}
      >
        <CardFace card={card} size="stage" />
      </motion.span>
    </div>
  );
}

/** 剩余时间条：从提示出现开始线性缩短；不在计时状态时显示空槽。 */
function TimeBar({ trial, hidden }: { trial: TrialState; hidden: boolean }) {
  const { t } = useTranslation();
  const running = trial.status === 'awaiting' && trial.cueT !== null && !hidden;
  const limit = trial.trial.timeLimitMs;
  const elapsed = running ? Math.max(0, performance.now() - (trial.cueT as number)) : 0;
  const start = Math.max(0, 1 - elapsed / limit);
  return (
    <div
      className={cn(
        'h-1 w-full max-w-md overflow-hidden rounded-full bg-surface-2',
        hidden && 'invisible',
      )}
      aria-hidden
      title={t('practice.timeBar')}
    >
      {running && (
        <motion.div
          key={`${trial.trial.id}-${trial.cueT}`}
          className="h-full origin-left rounded-full bg-primary/70"
          initial={{ scaleX: start }}
          animate={{ scaleX: 0 }}
          transition={{ duration: (limit - elapsed) / 1000, ease: 'linear' }}
        />
      )}
    </div>
  );
}

function Feedback({ view }: { view: PracticeView }) {
  const { t } = useTranslation();
  const state = view.trial as TrialState;
  const fb = state.feedback;
  const from = chordOf(state.trial.fromChordId);
  const outcome = state.outcome;
  const noCorrection = view.spec?.requireCorrection === false;

  let tone: 'idle' | 'ok' | 'bad' | 'warn' = 'idle';
  let body: ReactNode = ' ';

  const shiftText = (shift: number) => {
    const abs = Math.abs(shift);
    const amount =
      abs % 12 === 0
        ? t('chords.octaves', { count: abs / 12 })
        : t('chords.semitones', { count: abs });
    return shift > 0 ? t('chords.shiftedUp', { amount }) : t('chords.shiftedDown', { amount });
  };
  const wrongText = (
    judge: { missing: readonly number[]; extra: readonly number[]; wrongBass?: boolean },
    target: readonly number[],
  ) => (
    <span className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      {judge.wrongBass && (
        <span>
          {t('practice.wrongBass', {
            note: noteNames([Math.min(...target)]).replace(/-?\d+$/, ''),
          })}
        </span>
      )}
      {judge.missing.length > 0 && (
        <span>{t('practice.missing', { notes: noteNames(judge.missing) })}</span>
      )}
      {judge.extra.length > 0 && (
        <span>{t('practice.extra', { notes: noteNames(judge.extra) })}</span>
      )}
    </span>
  );

  if (fb?.shift != null && !fb.judge.correct && state.status !== 'done') {
    tone = 'warn';
    body = (
      <>
        <TriangleAlert className="size-5 shrink-0" aria-hidden />
        {shiftText(fb.shift)}
      </>
    );
  } else if (state.status === 'setup' && from) {
    const name = chordLabel(from);
    if (fb?.stage === 'from' && !fb.judge.correct) {
      tone = 'bad';
      body = (
        <>
          <X className="size-5 shrink-0" aria-hidden />
          {t('practice.fromWrong', { name })}
          {wrongText(fb.judge, state.trial.from ?? [])}
        </>
      );
    } else {
      body = (
        <>
          <CircleDashed className="size-5 shrink-0" aria-hidden />
          {t('practice.firstPlay', { name })}
        </>
      );
    }
  } else if (state.status === 'awaiting' && state.trial.hintAtStart) {
    body = (
      <>
        <Lightbulb className="size-5 shrink-0" aria-hidden />
        {view.spec?.hints === 'always' ? t('practice.guidedHint') : t('practice.hintAtStart')}
      </>
    );
  } else if (state.status === 'retry') {
    tone = 'bad';
    const latest = fb?.stage === 'target' ? fb.judge : null;
    body = (
      <>
        <X className="size-5 shrink-0" aria-hidden />
        {outcome?.timedOut && !latest ? (
          <span>{t('practice.timeout')}</span>
        ) : latest ? (
          wrongText(latest, state.trial.target)
        ) : null}
        {!noCorrection && <span className="text-muted-foreground">{t('practice.fixIt')}</span>}
      </>
    );
  } else if (state.status === 'done' && outcome) {
    if (outcome.correct) {
      tone = outcome.together === false ? 'warn' : 'ok';
      body = (
        <>
          <Check className="size-5 shrink-0" aria-hidden />
          <span className="font-semibold">{t('practice.correct')}</span>
          {outcome.reactionMs !== null && (
            <span className="font-mono tabular-nums">
              {t('practice.seconds', { s: seconds(outcome.reactionMs) })}
            </span>
          )}
          {outcome.spreadMs !== null && (
            <span className="text-muted-foreground">
              {outcome.together
                ? t('practice.spread', { ms: Math.round(outcome.spreadMs) })
                : t('practice.notTogether', { ms: Math.round(outcome.spreadMs) })}
            </span>
          )}
        </>
      );
    } else if (noCorrection) {
      tone = 'bad';
      body = (
        <>
          <X className="size-5 shrink-0" aria-hidden />
          {outcome.timedOut ? t('practice.timeout') : t('practice.wrong')}
        </>
      );
    } else {
      tone = 'ok';
      body = (
        <>
          <Check className="size-5 shrink-0" aria-hidden />
          {t('practice.correct')}
        </>
      );
    }
  }

  return (
    <div className="flex min-h-16 flex-col items-center gap-1">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'flex flex-wrap items-center justify-center gap-2 text-center text-base',
          tone === 'idle' && 'text-muted-foreground',
          tone === 'ok' && 'text-mark-correct',
          tone === 'bad' && 'text-mark-extra',
          tone === 'warn' && 'text-warning',
        )}
      >
        {body}
      </div>
      {view.adaptiveChange && view.nextTimeLimitMs !== null && (
        <p className="text-sm text-subtle-foreground">
          {view.adaptiveChange === 'tighten'
            ? t('practice.tighten', { s: seconds(view.nextTimeLimitMs) })
            : t('practice.loosen', { s: seconds(view.nextTimeLimitMs) })}
        </p>
      )}
    </div>
  );
}

/** 按下的音在判定前就松开了（没有算作答）：提示按住一下。显示 2.5 秒。 */
export function ShortTapNotice({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const tap = useLiveInput((s) => s.lastShortTap);
  const [shown, setShown] = useState<typeof tap>(null);
  useEffect(() => {
    // 进入页面之前的旧记录不显示
    if (!tap || performance.now() - tap.t > 1000) return;
    setShown(tap);
    const h = setTimeout(() => setShown(null), 2500);
    return () => clearTimeout(h);
  }, [tap]);
  if (!shown || !active) return null;
  return (
    <p
      role="status"
      data-testid="short-tap"
      className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-sm text-warning"
    >
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      {t('practice.shortTap')}
    </p>
  );
}
