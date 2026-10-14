import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/design/ui/button';
import { LoadingScreen } from '@/features/practice/PracticeSessionPage';
import { CenteredMessage } from '@/features/practice/SessionRunner';
import { useDocumentTitle } from '@/lib/use-document-title';
import { type ProgressionPrefs, useSettings } from '@/stores/settings';
import { ProgressionRunner } from './ProgressionRunner';
import { bpmFor, ChordChain, selectedSource, useProgressionPrefs } from './ProgressionSetupPage';
import { RunSummaryView } from './RunSummaryView';
import { progressionRun, useRun } from './run';
import type { RunConfig } from './run-controller';
import { type RunSource, runSpecFrom } from './run-source';

export function practiceRunConfig(source: RunSource, prefs: ProgressionPrefs): RunConfig {
  const s = useSettings.getState().settings;
  return {
    kind: 'practice',
    source,
    spec: runSpecFrom(source, {
      bpm: bpmFor(prefs, source.id),
      beatsPerChord: prefs.beatsPerChord,
      loops: prefs.loops === 0 ? null : prefs.loops,
      voicingMode: prefs.voicingMode,
      hintsVisible: !prefs.hideVoicings,
      latencyMs: s.latencyOffsetMs,
      onsetWindowMs: s.onsetWindowMs,
    }),
    click: { mode: prefs.clickMode, accent: prefs.accent },
    adaptiveBpm: prefs.adaptiveBpm,
  };
}

/** Esc：弹奏中结束这一遍，结束后执行 onLeave */
export function useEscapeToStop(onLeave: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (progressionRun.view.status === 'running') progressionRun.stop();
      else onLeave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onLeave]);
}

/** 进行练习器（专注模式） */
export function ProgressionRunPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('progression.title'));
  const navigate = useNavigate();
  const [prefs, setPrefs] = useProgressionPrefs();
  const status = useRun((v) => v.status);
  // 进入页面时的设置；"再来一遍"时重新读取（可能采用了新的 BPM）
  const selected = useMemo(() => selectedSource(prefs), [prefs]);
  const source = selected.ok ? selected.source : null;

  const start = useCallback(() => {
    const current = useSettings.getState().settings.progression;
    const sel = selectedSource(current);
    if (sel.ok) void progressionRun.start(practiceRunConfig(sel.source, current));
  }, []);

  useEffect(() => {
    start();
    return () => progressionRun.dispose();
  }, [start]);

  useEscapeToStop(useCallback(() => void navigate({ to: '/practice/progression' }), [navigate]));

  if (!source) {
    return (
      <CenteredMessage>
        <p>{t('progression.customEmpty')}</p>
        <Button asChild variant="outline">
          <Link to="/practice/progression">{t('practice.back')}</Link>
        </Button>
      </CenteredMessage>
    );
  }
  if (status === 'summary') {
    return (
      <RunSummaryView
        source={source}
        onAgain={start}
        onApplyBpm={(bpm) => setPrefs({ bpm: { ...prefs.bpm, [source.id]: bpm } })}
      />
    );
  }
  if (status === 'error') {
    return (
      <CenteredMessage>
        <p>{t('progression.audioError')}</p>
        <Button onClick={start}>{t('progression.start')}</Button>
      </CenteredMessage>
    );
  }
  if (status !== 'running') return <LoadingScreen />;
  return (
    <ProgressionRunner
      source={source}
      title={<ChordChain chords={source.steps.map((s) => s.chord)} />}
    />
  );
}
