import { BUILTIN_PACK, type TopicEntry } from '@mayochord/content';
import { type DiagnosticState, emptyDiagnostic, nextProbe, recordProbe } from '@mayochord/core';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Check, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/design/ui/button';
import { listSep, localize } from '@/lib/localize';
import { useDocumentTitle } from '@/lib/use-document-title';
import { cn } from '@/lib/utils';
import type { SessionResult, SessionSpec } from '../practice/controller';
import { LoadingScreen, useEscapeToFinish } from '../practice/PracticeSessionPage';
import { practice, usePractice } from '../practice/practice';
import { CenteredMessage, SessionRunner } from '../practice/SessionRunner';
import { learning, refreshLearning, useLearning } from './service';
import { checkTimeLimit, spread } from './specs';

/** 每个主题测几题、答对几题算通过；最多测几个主题 */
const QUESTIONS = 4;
const PASS = 3;
const MAX_PROBES = 10;

const pick = localize;

/** 诊断测试里一个主题的题目：均匀挑 QUESTIONS 张卡，限时、不能看提示、答错不重做 */
export function diagnosticSpec(topic: TopicEntry): SessionSpec {
  const cards = spread(topic.cards, QUESTIONS);
  return {
    kind: 'diagnostic',
    cards,
    length: cards.length,
    order: 'mixed',
    hints: 'never',
    fixedTimeLimitMs: Math.max(topic.lesson.mastery.timeLimitMs, checkTimeLimit(cards)),
    retryWrong: false,
    requireCorrection: false,
    config: { topicId: topic.id },
  };
}

/** 能用来诊断的主题：跟拍（M4）、节奏读谱（M10）主题要节拍器、时间较长，不参与（由先修关系推断） */
export const diagnosable = (t: TopicEntry) =>
  t.practice.kind !== 'progression' && t.practice.kind !== 'rhythms';

type Stage =
  | { kind: 'intro' }
  | { kind: 'running'; topicId: string }
  | { kind: 'between'; topicId: string; passed: boolean; correct: number; total: number }
  | { kind: 'saving' }
  | { kind: 'done'; mastered: string[] };

/**
 * 诊断测试（规格 6.6）：有基础的人不用从头学。每次测一个主题的 4 道题，
 * 通过 → 它和它的先修都算已掌握；没通过 → 依赖它的主题都还要学。最多测 10 个主题，可以随时停下。
 */
export function DiagnosticPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('diagnostic.title'));
  const navigate = useNavigate();
  const snapshot = useLearning((s) => s.snapshot);
  const status = usePractice((v) => v.status);
  const [stage, setStage] = useState<Stage>({ kind: 'intro' });
  const [state, setState] = useState<DiagnosticState>(emptyDiagnostic);

  useEffect(() => {
    if (!snapshot) void refreshLearning();
    return () => practice.dispose();
  }, [snapshot]);

  // 已经掌握的主题不用测
  const candidates = useMemo(
    () =>
      BUILTIN_PACK.topics
        .filter((tp) => diagnosable(tp) && snapshot?.topicProgress.get(tp.id)?.masteredAt == null)
        .map((tp) => tp.id),
    [snapshot],
  );
  const probes = state.passed.length + state.failed.length;
  const next = probes < MAX_PROBES ? nextProbe(BUILTIN_PACK.graph, state, candidates) : null;

  const finish = useCallback(async (s: DiagnosticState) => {
    setStage({ kind: 'saving' });
    const mastered = await learning.recordDiagnostic(s.passed, s.known);
    await refreshLearning();
    setStage({ kind: 'done', mastered });
  }, []);

  const probe = useCallback(
    (topicId: string) => {
      const topic = BUILTIN_PACK.topicById.get(topicId);
      if (!topic) return;
      setStage({ kind: 'running', topicId });
      void practice.start(diagnosticSpec(topic));
      const off = practice.onFinish((result: SessionResult) => {
        off();
        if (!result.completed) {
          // 中途按了 Esc：到这里为止
          void finish(state);
          return;
        }
        const correct = result.logs.filter((l) => l.correct).length;
        const passed = correct >= Math.min(PASS, result.logs.length);
        setState((s) => recordProbe(BUILTIN_PACK.graph, s, topicId, passed));
        setStage({ kind: 'between', topicId, passed, correct, total: result.logs.length });
      });
    },
    [finish, state],
  );

  useEscapeToFinish(useCallback(() => void navigate({ to: '/' }), [navigate]));

  if (!snapshot) return <LoadingScreen />;

  switch (stage.kind) {
    case 'intro':
      return (
        <CenteredMessage>
          <p className="font-mono text-xs tracking-[0.2em] text-primary uppercase">
            {t('diagnostic.eyebrow')}
          </p>
          <h1 className="font-cjk-heading text-2xl font-semibold sm:text-3xl">
            {t('diagnostic.title')}
          </h1>
          <p className="text-muted-foreground">
            {t('diagnostic.intro', { n: QUESTIONS, pass: PASS, max: MAX_PROBES })}
          </p>
          {next ? (
            <div className="flex flex-wrap justify-center gap-3">
              <Button size="lg" onClick={() => probe(next)} autoFocus>
                {t('diagnostic.start')}
                <ArrowRight />
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/">{t('diagnostic.skip')}</Link>
              </Button>
            </div>
          ) : (
            <p>{t('diagnostic.nothing')}</p>
          )}
        </CenteredMessage>
      );
    case 'running': {
      const topic = BUILTIN_PACK.topicById.get(stage.topicId);
      if (status !== 'running' || !topic) return <LoadingScreen />;
      return (
        <SessionRunner
          title={`${t('diagnostic.title')} · ${t('diagnostic.probeN', { i: probes + 1 })} · ${pick(topic.title)}`}
        />
      );
    }
    case 'between': {
      const topic = BUILTIN_PACK.topicById.get(stage.topicId);
      return (
        <CenteredMessage>
          <div
            className={cn(
              'grid size-14 place-items-center rounded-full',
              stage.passed ? 'bg-mark-correct/15 text-mark-correct' : 'bg-warning/15 text-warning',
            )}
          >
            {stage.passed ? (
              <Check className="size-7" aria-hidden />
            ) : (
              <X className="size-7" aria-hidden />
            )}
          </div>
          <h1 className="font-cjk-heading text-xl font-semibold" data-testid="probe-result">
            {stage.passed
              ? t('diagnostic.passed', { topic: topic ? pick(topic.title) : '' })
              : t('diagnostic.failed', { topic: topic ? pick(topic.title) : '' })}
          </h1>
          <p className="font-mono text-sm text-muted-foreground tabular-nums">
            {stage.correct}/{stage.total}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('diagnostic.progress', { known: state.known.length, unknown: state.unknown.length })}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {next ? (
              <>
                <Button onClick={() => probe(next)} autoFocus>
                  {t('diagnostic.next')}
                  <ArrowRight />
                </Button>
                <Button variant="outline" onClick={() => void finish(state)}>
                  {t('diagnostic.stopHere')}
                </Button>
              </>
            ) : (
              <Button onClick={() => void finish(state)} autoFocus>
                {t('diagnostic.finish')}
              </Button>
            )}
          </div>
        </CenteredMessage>
      );
    }
    case 'saving':
      return <LoadingScreen />;
    case 'done':
      return (
        <CenteredMessage>
          <h1 className="font-cjk-heading text-2xl font-semibold" data-testid="diagnostic-done">
            {stage.mastered.length > 0
              ? t('diagnostic.doneTitle', { n: stage.mastered.length })
              : t('diagnostic.doneNone')}
          </h1>
          {stage.mastered.length > 0 && (
            <p className="text-muted-foreground">
              {stage.mastered
                .map((id) => BUILTIN_PACK.topicById.get(id))
                .map((tp) => (tp ? pick(tp.title) : ''))
                .join(listSep())}
            </p>
          )}
          <p className="text-sm text-muted-foreground">{t('diagnostic.doneBody')}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild>
              <Link to="/">{t('learn.backToToday')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/graph">{t('learn.toGraph')}</Link>
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setState(emptyDiagnostic());
                setStage({ kind: 'intro' });
              }}
            >
              <RotateCcw />
              {t('diagnostic.again')}
            </Button>
          </div>
        </CenteredMessage>
      );
  }
}
