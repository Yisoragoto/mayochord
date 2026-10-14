import {
  BUILTIN_PACK,
  type ChordEntry,
  type ExplainStep,
  type TopicEntry,
} from '@mayochord/content';
import { nameToMidi, prettyAccidentals, voicingMidi } from '@mayochord/core';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, AudioLines, Check, RotateCcw, Volume2, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { playChordCue } from '@/audio/cues';
import { getPiano } from '@/audio/piano';
import { Keyboard, type KeyMark } from '@/design/keyboard/Keyboard';
import { Button } from '@/design/ui/button';
import { keyboardRange, referenceMarks } from '@/features/chords/voicing-view';
import { useDocumentTitle } from '@/lib/use-document-title';
import { cn } from '@/lib/utils';
import { ChordStaff } from '../practice/ChordCues';
import type { SessionResult, SessionSpec } from '../practice/controller';
import { LoadingScreen, useEscapeToFinish } from '../practice/PracticeSessionPage';
import { practice, usePractice } from '../practice/practice';
import { CenteredMessage, SessionRunner } from '../practice/SessionRunner';
import type { TopicOutcome } from './learning';
import { RhythmLesson } from './RhythmLesson';
import { learning, refreshLearning } from './service';
import { guidedSpec, independentSpec, masterySpec } from './specs';

type Stage =
  | { kind: 'explain' }
  | { kind: 'intro'; next: 'guided' | 'independent' | 'mastery' }
  | { kind: 'running'; spec: SessionSpec }
  | { kind: 'paused'; spec: SessionSpec }
  | { kind: 'result'; outcome: TopicOutcome };

const pick = (text: { 'zh-CN': string }) => text['zh-CN'];

/**
 * 主题课程（规格 6.2）：讲解与示范 → 引导练习 → 独立练习 → 掌握检查。
 * 从每日任务进入时带 taskId，通过掌握检查后把任务标记为完成。
 */
export function LessonPage(props: { topicId: string; taskId?: string | undefined }) {
  const topic = BUILTIN_PACK.topicById.get(props.topicId);
  // 跟拍主题（M4）：引导、独立、掌握检查都是跟着节拍器弹进行
  if (topic?.practice.kind === 'progression') {
    return <RhythmLesson key={topic.id} topic={topic} taskId={props.taskId} />;
  }
  return <DrillLesson key={props.topicId} {...props} />;
}

function DrillLesson({ topicId, taskId }: { topicId: string; taskId?: string | undefined }) {
  const { t } = useTranslation();
  const topic = BUILTIN_PACK.topicById.get(topicId);
  useDocumentTitle(topic ? pick(topic.title) : t('learn.lesson'));
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>({ kind: 'explain' });
  const xp = useRef(0);
  const status = usePractice((v) => v.status);

  useEffect(() => {
    if (topic) void learning.recordLessonStart(topic.id);
    return () => practice.dispose();
  }, [topic]);

  const leave = useCallback(() => void navigate({ to: '/' }), [navigate]);
  useEscapeToFinish(leave);

  const run = useCallback(
    (spec: SessionSpec) => {
      if (!topic) return;
      setStage({ kind: 'running', spec });
      // start() 会先 dispose()（清掉旧的回调），所以先 start 再订阅
      void practice.start(spec);
      const off = practice.onFinish((result: SessionResult) => {
        off();
        xp.current += result.xp;
        if (!result.completed) {
          setStage({ kind: 'paused', spec });
          return;
        }
        if (spec.kind === 'guided') setStage({ kind: 'intro', next: 'independent' });
        else if (spec.kind === 'independent') setStage({ kind: 'intro', next: 'mastery' });
        else if (spec.kind === 'mastery') {
          void learning.recordMastery(topic.id, result).then(async (outcome) => {
            if (outcome.passed) {
              await learning.completeLesson(topic.id, taskId, xp.current, outcome.accuracy);
            }
            await refreshLearning();
            setStage({ kind: 'result', outcome });
          });
        }
      });
    },
    [topic, taskId],
  );

  const startStage = useCallback(
    (next: 'guided' | 'independent' | 'mastery') => {
      if (!topic) return;
      run(
        next === 'guided'
          ? guidedSpec(topic)
          : next === 'independent'
            ? independentSpec(topic)
            : masterySpec(topic),
      );
    },
    [topic, run],
  );

  if (!topic) {
    return (
      <CenteredMessage>
        <p>{t('learn.notFound')}</p>
        <Button asChild variant="outline">
          <Link to="/graph">{t('learn.toGraph')}</Link>
        </Button>
      </CenteredMessage>
    );
  }

  switch (stage.kind) {
    case 'explain':
      return (
        <Explain
          topic={topic}
          onDone={() => setStage({ kind: 'intro', next: 'guided' })}
          onSkipToCheck={() => setStage({ kind: 'intro', next: 'mastery' })}
          onExit={leave}
        />
      );
    case 'intro':
      return (
        <StageIntro
          topic={topic}
          next={stage.next}
          onStart={() => startStage(stage.next)}
          onExit={leave}
        />
      );
    case 'running':
      if (status === 'running') {
        return (
          <SessionRunner title={`${t(`learn.stage.${stage.spec.kind}`)} · ${pick(topic.title)}`} />
        );
      }
      return <LoadingScreen />;
    case 'paused':
      return (
        <CenteredMessage>
          <h1 className="font-cjk-heading text-2xl font-semibold">{t('learn.pausedTitle')}</h1>
          <p className="text-muted-foreground">{t('learn.pausedBody')}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button onClick={() => run(stage.spec)}>
              <RotateCcw />
              {t('learn.resume')}
            </Button>
            <Button variant="outline" onClick={leave}>
              {t('learn.backToToday')}
            </Button>
          </div>
        </CenteredMessage>
      );
    case 'result':
      return (
        <LessonResult
          topic={topic}
          outcome={stage.outcome}
          xp={xp.current}
          onRetryCheck={() => startStage('mastery')}
          onPracticeMore={() => startStage('independent')}
        />
      );
  }
}

export function LessonFrame({
  topic,
  onExit,
  step,
  children,
}: {
  topic: TopicEntry;
  onExit: () => void;
  step?: { index: number; total: number };
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onExit} aria-label={t('practice.exitLabel')}>
          <X />
          {t('practice.exit')}
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{pick(topic.title)}</p>
        </div>
        {step && (
          <ol
            className="flex gap-1.5"
            aria-label={t('learn.stepOf', { i: step.index + 1, n: step.total })}
          >
            {Array.from({ length: step.total }, (_, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: 固定数量的步骤点
                key={i}
                className={cn(
                  'size-2 rounded-full',
                  i <= step.index ? 'bg-primary' : 'bg-surface-2',
                )}
              />
            ))}
          </ol>
        )}
      </div>
      <div className="flex flex-1 flex-col justify-center py-8">{children}</div>
    </div>
  );
}

/** 讲解与示范：文字 + 键盘标记 + 播放 */
export function Explain({
  topic,
  onDone,
  onSkipToCheck,
  onExit,
}: {
  topic: TopicEntry;
  onDone: () => void;
  onSkipToCheck: () => void;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const steps = topic.lesson.explain;
  const step = steps[i] as ExplainStep;
  const last = i === steps.length - 1;
  return (
    <LessonFrame topic={topic} onExit={onExit} step={{ index: i, total: steps.length }}>
      <motion.div
        key={i}
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="space-y-8"
      >
        {i === 0 && (
          <div className="space-y-2">
            <p className="font-mono text-xs tracking-[0.2em] text-primary uppercase">
              {t('learn.stage.explain')}
            </p>
            <h1 className="font-cjk-heading text-3xl font-semibold tracking-tight sm:text-4xl">
              {pick(topic.title)}
            </h1>
          </div>
        )}
        <p className="max-w-2xl text-lg leading-relaxed sm:text-xl" data-testid="explain-text">
          {pick(step.text)}
        </p>
        {step.demo && <Demo demo={step.demo} />}
      </motion.div>
      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => setI(i - 1)} disabled={i === 0}>
          <ArrowLeft />
          {t('learn.prev')}
        </Button>
        <Button onClick={() => (last ? onDone() : setI(i + 1))}>
          {last ? t('learn.startGuided') : t('learn.next')}
          <ArrowRight />
        </Button>
        <Button variant="ghost" className="ml-auto" onClick={onSkipToCheck}>
          {t('learn.skipToCheck')}
        </Button>
      </div>
    </LessonFrame>
  );
}

function Demo({ demo }: { demo: NonNullable<ExplainStep['demo']> }) {
  const { notes, marks } = useMemo(() => {
    const m = new Map<number, KeyMark>();
    if (demo.chord) {
      const chord = BUILTIN_PACK.chordById.get(demo.chord);
      if (!chord) return { notes: [] as number[], marks: m };
      for (const [n, mark] of referenceMarks(chord.reference)) {
        m.set(
          n,
          demo.labels === 'fingers'
            ? mark
            : { kind: 'target', ...(mark.hand ? { hand: mark.hand } : {}) },
        );
      }
      return { notes: voicingMidi(chord.reference), marks: m };
    }
    const ns = (demo.notes ?? []).map((n) => nameToMidi(n) as number);
    ns.forEach((n, idx) => {
      const mark: KeyMark = { kind: 'target', hand: 'right' };
      if (demo.labels === 'semitones') mark.finger = idx;
      m.set(n, mark);
    });
    return { notes: ns, marks: m };
  }, [demo]);
  if (notes.length === 0) return null;
  const range = keyboardRange(notes, 4);
  const chord = demo.chord ? BUILTIN_PACK.chordById.get(demo.chord) : undefined;
  const showStaff = chord && (demo.show === 'staff' || demo.show === 'both');
  const showKeyboard = demo.show !== 'staff' || !chord;
  return (
    <div className="space-y-4">
      {showStaff && <ChordStaff chord={chord} className="max-w-sm" />}
      {showKeyboard && (
        <Keyboard
          low={range.low}
          high={range.high}
          marks={marks}
          labels="all"
          className="max-w-3xl"
        />
      )}
      {demo.play === 'cadence' && chord ? (
        <CadencePlay chord={chord} musicKey={demo.key ?? 'C'} />
      ) : (
        demo.play !== 'none' && <DemoPlay notes={notes} arpeggio={demo.play === 'arpeggio'} />
      )}
    </div>
  );
}

/** 听辨课程的示范：先播放这个调的终止式，再播放和弦 */
function CadencePlay({ chord, musicKey }: { chord: ChordEntry; musicKey: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => void playChordCue(chord, musicKey).catch(() => undefined)}>
        <Volume2 />
        {t('learn.playCadence', { key: prettyAccidentals(musicKey) })}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void playChordCue(chord, null).catch(() => undefined)}
      >
        <AudioLines />
        {t('learn.playChordOnly')}
      </Button>
    </div>
  );
}

function DemoPlay({ notes, arpeggio }: { notes: number[]; arpeggio: boolean }) {
  const { t } = useTranslation();
  const play = async (stagger: number) => {
    try {
      const piano = await getPiano();
      piano.playNotes(notes, { stagger, duration: stagger ? 2.4 : 1.8 });
    } catch {
      /* 采样加载失败时静默；和弦库页面有错误提示 */
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant={arpeggio ? 'outline' : 'default'} onClick={() => void play(0)}>
        <Volume2 />
        {t('chords.playBlock')}
      </Button>
      <Button size="sm" variant={arpeggio ? 'default' : 'outline'} onClick={() => void play(0.22)}>
        <AudioLines />
        {t('chords.playArpeggio')}
      </Button>
    </div>
  );
}

export function StageIntro({
  topic,
  next,
  onStart,
  onExit,
  body: bodyOverride,
}: {
  topic: TopicEntry;
  next: 'guided' | 'independent' | 'mastery';
  onStart: () => void;
  onExit: () => void;
  /** 替换默认的说明文字（跟拍主题） */
  body?: string;
}) {
  const { t } = useTranslation();
  const m = topic.lesson.mastery;
  const body =
    bodyOverride ??
    (next === 'guided'
      ? t('learn.guidedIntro', { n: Math.min(topic.lesson.guided.count, topic.cards.length) })
      : next === 'independent'
        ? t('learn.independentIntro', { n: topic.lesson.independent.requiredCorrect })
        : t('learn.masteryIntro', {
            n: m.questions,
            pct: Math.round(m.minAccuracy * 100),
            s: (m.timeLimitMs / 1000).toFixed(1).replace(/\.0$/, ''),
          }));
  return (
    <LessonFrame topic={topic} onExit={onExit}>
      <div className="space-y-4">
        <p className="font-mono text-xs tracking-[0.2em] text-primary uppercase">
          {t(`learn.stage.${next}`)}
        </p>
        <p className="max-w-2xl text-lg leading-relaxed">{body}</p>
        <Button size="lg" onClick={onStart} autoFocus>
          {t('learn.start')}
          <ArrowRight />
        </Button>
      </div>
    </LessonFrame>
  );
}

export function LessonResult({
  topic,
  outcome,
  xp,
  onRetryCheck,
  onPracticeMore,
  measure = 'accuracy',
}: {
  topic: TopicEntry;
  outcome: TopicOutcome;
  xp: number;
  onRetryCheck: () => void;
  onPracticeMore: () => void;
  /** 跟拍主题看"干净率"（对、在拍上、同时落下） */
  measure?: 'accuracy' | 'clean';
}) {
  const { t } = useTranslation();
  const pct = Math.round(outcome.accuracy * 100);
  const need = Math.round(topic.lesson.mastery.minAccuracy * 100);
  return (
    <CenteredMessage>
      <div
        className={cn(
          'grid size-16 place-items-center rounded-full',
          outcome.passed ? 'bg-mark-correct/15 text-mark-correct' : 'bg-warning/15 text-warning',
        )}
      >
        {outcome.passed ? (
          <Check className="size-8" aria-hidden />
        ) : (
          <RotateCcw className="size-8" aria-hidden />
        )}
      </div>
      <h1 className="font-cjk-heading text-2xl font-semibold" data-testid="lesson-result">
        {outcome.passed
          ? t('learn.passedTitle', { topic: pick(topic.title) })
          : t('learn.failedTitle')}
      </h1>
      <p className="text-muted-foreground">
        {measure === 'clean'
          ? outcome.passed
            ? t('learn.passedBodyClean', { pct })
            : t('learn.failedBodyClean', { pct, need })
          : outcome.passed
            ? t('learn.passedBody', { pct })
            : t('learn.failedBody', { pct, need })}
      </p>
      <p className="font-mono text-sm text-primary tabular-nums">
        {t('learn.xpEarned', { xp: xp.toFixed(1) })}
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {outcome.passed ? (
          <>
            <Button asChild>
              <Link to="/">{t('learn.backToToday')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/graph">{t('learn.toGraph')}</Link>
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onPracticeMore}>{t('learn.practiceMore')}</Button>
            <Button variant="outline" onClick={onRetryCheck}>
              {t('learn.retryCheck')}
            </Button>
            <Button asChild variant="ghost">
              <Link to="/">{t('learn.backToToday')}</Link>
            </Button>
          </>
        )}
      </div>
    </CenteredMessage>
  );
}
