import { BUILTIN_PACK, type TopicEntry } from '@mayochord/content';
import { useNavigate } from '@tanstack/react-router';
import { RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/design/ui/button';
import { LoadingScreen } from '@/features/practice/PracticeSessionPage';
import { CenteredMessage } from '@/features/practice/SessionRunner';
import { ProgressionRunner } from '@/features/progression/ProgressionRunner';
import { useEscapeToStop } from '@/features/progression/ProgressionRunPage';
import { progressionRun, useRun } from '@/features/progression/run';
import type { RunConfig, RunKind, RunResult } from '@/features/progression/run-controller';
import {
  type RunSource,
  runSpecFrom,
  sourceFromProgression,
} from '@/features/progression/run-source';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useSettings } from '@/stores/settings';
import { Explain, LessonResult, StageIntro } from './LessonPage';
import type { TopicOutcome } from './learning';
import { learning, refreshLearning } from './service';

type Next = 'guided' | 'independent' | 'mastery';
type Stage =
  | { kind: 'explain' }
  | { kind: 'intro'; next: Next }
  | { kind: 'running'; next: Next }
  | { kind: 'paused'; next: Next }
  | { kind: 'result'; outcome: TopicOutcome };

const pick = (text: { 'zh-CN': string }) => text['zh-CN'];
/** 引导练习放慢到目标速度的 80% */
const GUIDED_FACTOR = 0.8;
const GUIDED_LOOPS = 2;

export interface RhythmPlan {
  source: RunSource;
  guidedBpm: number;
  bpm: number;
  /** 掌握检查弹几遍（至少弹满 mastery.questions 个和弦） */
  masteryLoops: number;
}

export function rhythmPlan(topic: TopicEntry): RhythmPlan | null {
  const pr = topic.practice;
  if (pr.kind !== 'progression') return null;
  const progression = BUILTIN_PACK.progressionById.get(pr.progression);
  if (!progression) return null;
  const source = sourceFromProgression(progression);
  return {
    source,
    bpm: pr.bpm,
    guidedBpm: Math.max(40, Math.round(pr.bpm * GUIDED_FACTOR)),
    masteryLoops: Math.max(1, Math.ceil(topic.lesson.mastery.questions / source.steps.length)),
  };
}

/** 课程某个阶段的跟拍练习 */
export function rhythmRunConfig(topic: TopicEntry, plan: RhythmPlan, next: Next): RunConfig {
  const pr = topic.practice;
  const s = useSettings.getState().settings;
  const kind: RunKind = next;
  return {
    kind,
    source: plan.source,
    spec: runSpecFrom(plan.source, {
      bpm: next === 'guided' ? plan.guidedBpm : plan.bpm,
      beatsPerChord: pr.kind === 'progression' ? (pr.beatsPerChord ?? 0) : 0,
      loops: next === 'guided' ? GUIDED_LOOPS : next === 'mastery' ? plan.masteryLoops : null,
      voicingMode: pr.kind === 'progression' ? pr.voicingMode : 'any',
      hintsVisible: next === 'guided',
      latencyMs: s.latencyOffsetMs,
      onsetWindowMs: s.onsetWindowMs,
    }),
    click: { mode: 'all', accent: true },
    adaptiveBpm: false,
    ...(next === 'independent' ? { targetClean: topic.lesson.independent.requiredCorrect } : {}),
    config: { topicId: topic.id },
  };
}

/**
 * 跟拍主题的课程：讲解示范 → 引导（放慢、显示键位）→ 独立（隐藏键位，干净地弹对 N 个和弦）→
 * 掌握检查（规格第 11 节：不停顿、没有错音、同时落下、跟住节拍器）。
 */
export function RhythmLesson({
  topic,
  taskId,
}: {
  topic: TopicEntry;
  taskId?: string | undefined;
}) {
  const { t } = useTranslation();
  useDocumentTitle(pick(topic.title));
  const navigate = useNavigate();
  const plan = rhythmPlan(topic);
  const [stage, setStage] = useState<Stage>({ kind: 'explain' });
  const xp = useRef(0);
  const status = useRun((v) => v.status);

  useEffect(() => {
    void learning.recordLessonStart(topic.id);
    return () => progressionRun.dispose();
  }, [topic]);

  const leave = useCallback(() => void navigate({ to: '/' }), [navigate]);
  useEscapeToStop(leave);

  const run = useCallback(
    (next: Next) => {
      if (!plan) return;
      setStage({ kind: 'running', next });
      // start() 会先 dispose()（清掉旧的回调），所以先 start 再订阅
      void progressionRun.start(rhythmRunConfig(topic, plan, next));
      const off = progressionRun.onFinish((result: RunResult) => {
        off();
        xp.current += result.xp;
        if (!result.completed) {
          setStage({ kind: 'paused', next });
          return;
        }
        if (next === 'guided') setStage({ kind: 'intro', next: 'independent' });
        else if (next === 'independent') setStage({ kind: 'intro', next: 'mastery' });
        else {
          void learning.recordRunMastery(topic.id, result).then(async (outcome) => {
            if (outcome.passed) {
              await learning.completeLesson(topic.id, taskId, xp.current, outcome.accuracy);
            }
            await refreshLearning();
            setStage({ kind: 'result', outcome });
          });
        }
      });
    },
    [topic, taskId, plan],
  );

  if (!plan) return null;
  const m = topic.lesson.mastery;
  const intro = (next: Next) =>
    next === 'guided'
      ? t('learn.rhythmGuidedIntro', { bpm: plan.guidedBpm, loops: GUIDED_LOOPS })
      : next === 'independent'
        ? t('learn.rhythmIndependentIntro', {
            bpm: plan.bpm,
            n: topic.lesson.independent.requiredCorrect,
          })
        : t('learn.rhythmMasteryIntro', {
            bpm: plan.bpm,
            n: plan.masteryLoops * plan.source.steps.length,
            pct: Math.round(m.minAccuracy * 100),
          });

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
          body={intro(stage.next)}
          onStart={() => run(stage.next)}
          onExit={leave}
        />
      );
    case 'running':
      if (status === 'running') {
        return (
          <ProgressionRunner
            source={plan.source}
            title={`${t(`learn.stage.${stage.next}`)} · ${pick(topic.title)}`}
          />
        );
      }
      if (status === 'error') {
        return (
          <CenteredMessage>
            <p>{t('progression.audioError')}</p>
            <Button onClick={() => run(stage.next)}>{t('progression.start')}</Button>
          </CenteredMessage>
        );
      }
      return <LoadingScreen />;
    case 'paused':
      return (
        <CenteredMessage>
          <h1 className="font-cjk-heading text-2xl font-semibold">{t('learn.pausedTitle')}</h1>
          <p className="text-muted-foreground">{t('learn.pausedBody')}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button onClick={() => run(stage.next)}>
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
          measure="clean"
          onRetryCheck={() => run('mastery')}
          onPracticeMore={() => run('independent')}
        />
      );
  }
}
