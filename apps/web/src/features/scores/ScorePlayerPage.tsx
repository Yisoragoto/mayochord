import {
  buildFollowPlan,
  chordSequence,
  type FollowSummary,
  type HandsMode,
  hasRepeats,
  labelChords,
  type MeasureStat,
  measureErrorRate,
  parseScoreSource,
  practiceSequence,
  type Score,
  worstMeasures,
} from '@mayochord/core';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  ChevronDown,
  Gauge,
  Info,
  Music,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Square,
  TriangleAlert,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type KeyMark, keyboardLayout, keyboardMaxWidth } from '@/design/keyboard/Keyboard';
import { Button } from '@/design/ui/button';
import { Slider } from '@/design/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/design/ui/toggle-group';
import { keyboardRange } from '@/features/chords/voicing-view';
import { MidiConnectButton } from '@/features/midi/MidiDevicePanel';
import { CenteredMessage } from '@/features/practice/SessionRunner';
import { SwitchRow } from '@/features/progression/ProgressionSetupPage';
import { PlayableKeyboard, releaseOnscreenNotes } from '@/input/PlayableKeyboard';
import { useDocumentTitle } from '@/lib/use-document-title';
import { cn } from '@/lib/utils';
import { type ScoreRecord, type ScoreRunRecord, tryRepositories } from '@/storage';
import { useSettings } from '@/stores/settings';
import { parsePrefs, type ScorePrefs } from './library';
import { scorePlayer, usePlayer } from './player';
import { StaffView } from './StaffView';
import { countInBeatsLeft, effectiveBpm, playheadTick } from './score-player';
import { WaterfallView } from './WaterfallView';

type Loaded =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error' }
  | { kind: 'ready'; record: ScoreRecord; score: Score };

function useScore(scoreId: string): Loaded {
  const [state, setState] = useState<Loaded>({ kind: 'loading' });
  useEffect(() => {
    let cancelled = false;
    const repos = tryRepositories();
    if (!repos) {
      setState({ kind: 'error' });
      return;
    }
    repos.scores
      .get(scoreId)
      .then((record) => {
        if (cancelled) return;
        if (!record) {
          setState({ kind: 'missing' });
          return;
        }
        try {
          setState({ kind: 'ready', record, score: parseScoreSource(record.source, record.title) });
        } catch {
          setState({ kind: 'error' });
        }
      })
      .catch(() => !cancelled && setState({ kind: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [scoreId]);
  return state;
}

/** 跟拍、试听：每帧算出播放到哪一组（只在变化时更新界面） */
function usePlayheadStep(): { step: number; countIn: number | null } {
  const [pos, setPos] = useState({ step: -1, countIn: null as number | null });
  const last = useRef(pos);
  const clock = usePlayer((v) => v.clock);
  const plan = usePlayer((v) => v.plan);
  useEffect(() => {
    if (!clock || !plan) return;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const view = scorePlayer.view;
      const now = performance.now();
      const tick = playheadTick(view, now);
      const countIn = countInBeatsLeft(view, now);
      let step = -1;
      if (tick !== null && countIn === null) {
        for (let i = 0; i < plan.steps.length; i++) {
          if ((plan.steps[i]?.tick ?? 0) <= tick + 1) step = i;
          else break;
        }
      }
      if (step !== last.current.step || countIn !== last.current.countIn) {
        last.current = { step, countIn };
        setPos(last.current);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [clock, plan]);
  return clock ? pos : { step: -1, countIn: null };
}

export function ScorePlayerPage({ scoreId }: { scoreId: string }) {
  const { t } = useTranslation();
  const loaded = useScore(scoreId);
  useDocumentTitle(loaded.kind === 'ready' ? loaded.record.title : t('scores.title'));
  useEffect(() => () => scorePlayer.dispose(), []);

  if (loaded.kind === 'loading') {
    return (
      <CenteredMessage>
        <p className="text-muted-foreground">{t('practice.loading')}</p>
      </CenteredMessage>
    );
  }
  if (loaded.kind !== 'ready') {
    return (
      <CenteredMessage>
        <p>{loaded.kind === 'missing' ? t('scores.missing') : t('scores.openError')}</p>
        <Button asChild variant="outline">
          <Link to="/scores">{t('scores.back')}</Link>
        </Button>
      </CenteredMessage>
    );
  }
  return <Player record={loaded.record} score={loaded.score} />;
}

function Player({ record, score }: { record: ScoreRecord; score: Score }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [prefs, setPrefsState] = useState<ScorePrefs>(() => parsePrefs(record.prefs));
  const [history, setHistory] = useState<ScoreRunRecord[]>([]);
  const status = usePlayer((v) => v.status);
  const error = usePlayer((v) => v.error);
  const summary = usePlayer((v) => v.summary);
  const plan = usePlayer((v) => v.plan);
  const k = usePlayer((v) => v.k);
  const pressed = usePlayer((v) => v.pressed);
  const wrong = usePlayer((v) => v.wrong);
  const marks = usePlayer((v) => v.marks);
  const clock = usePlayer((v) => v.clock);
  const running = status === 'running' || status === 'starting';
  const playhead = usePlayheadStep();
  const latencyCalibrated = useSettings((s) => s.settings.latencyCalibrated);

  const last = score.measures.length - 1;
  const from = Math.min(prefs.from, last);
  const to = Math.max(from, Math.min(prefs.to ?? last, last));

  const setPrefs = useCallback(
    (patch: Partial<ScorePrefs>) => {
      setPrefsState((p) => {
        const next = { ...p, ...patch };
        void tryRepositories()
          ?.scores.update(record.id, { prefs: next })
          .catch(() => undefined);
        return next;
      });
    },
    [record.id],
  );

  const loadHistory = useCallback(() => {
    void tryRepositories()
      ?.scores.runs(record.id)
      .then(setHistory)
      .catch(() => undefined);
  }, [record.id]);
  useEffect(loadHistory, [loadHistory]);

  // 谱上没写速度（例如识谱软件转出来的）时可以自己定原速
  const playScore = useMemo(
    () => (prefs.baseBpm ? { ...score, tempo: prefs.baseBpm, tempoMarked: true } : score),
    [score, prefs.baseBpm],
  );

  const start = useCallback(() => {
    void scorePlayer.start({
      scoreId: record.id,
      score: playScore,
      mode: prefs.mode,
      hands: prefs.hands,
      otherHand: prefs.otherHand,
      from,
      to,
      speed: prefs.speed,
      loops: prefs.loops === 0 ? null : prefs.loops,
      metronome: prefs.metronome,
      expandRepeats: prefs.repeats,
      latencyMs: useSettings.getState().settings.latencyOffsetMs,
    });
  }, [record.id, playScore, prefs, from, to]);

  // 结束后刷新历史
  useEffect(() => {
    if (status === 'summary') {
      const id = setTimeout(loadHistory, 300);
      return () => clearTimeout(id);
    }
  }, [status, loadHistory]);

  // Esc：弹奏中结束，否则回到乐谱库
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (scorePlayer.view.status === 'running') scorePlayer.stop();
      else if (scorePlayer.view.status === 'summary') scorePlayer.dispose();
      else void navigate({ to: '/scores' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const range = useMemo(() => {
    const pitches = score.notes.map((n) => n.pitch);
    const r = keyboardRange(pitches, 2);
    // 至少两个八度，键盘不会太窄
    if (r.high - r.low < 24) {
      const mid = Math.round((r.low + r.high) / 2);
      return keyboardRange([mid - 12, mid + 12], 0);
    }
    return r;
  }, [score]);

  // 当前一组：等待模式看控制器；跟拍/试听看播放位置
  const stepIndex = !plan || !running ? -1 : clock ? playhead.step : k % plan.steps.length;
  const step = plan && running && stepIndex >= 0 ? plan.steps[stepIndex] : undefined;
  const currentIds = useMemo(
    () => (step ? [...step.notes, ...step.auto].map((n) => n.id) : []),
    [step],
  );
  const focusMeasure = step?.measure ?? from;

  // 点击切换模式的屏幕键盘：每到下一组自动松开（不然再点一下同一个键是"抬起"）
  useEffect(() => {
    if (stepIndex >= 0 && useSettings.getState().settings.onscreenMode === 'latch') {
      releaseOnscreenNotes();
    }
  }, [stepIndex]);

  const keyMarks = useMemo(() => {
    const m = new Map<number, KeyMark>();
    if (!running || !step) return m;
    if (prefs.keyHints) {
      for (const n of step.notes) {
        m.set(n.pitch, { kind: pressed.includes(n.pitch) ? 'correct' : 'target', hand: n.hand });
      }
    }
    for (const p of wrong) m.set(p, { kind: 'extra' });
    return m;
  }, [running, step, prefs.keyHints, pressed, wrong]);

  const heat = useMemo(() => {
    if (status !== 'summary' || !summary) return null;
    return new Map(summary.measures.map((s) => [s.measure, measureErrorRate(s)]));
  }, [status, summary]);

  const worst = useMemo(() => worstMeasures(history.map((r) => r.summary.measures)), [history]);

  const onMeasureClick = (index: number, shift: boolean) => {
    if (running) return;
    if (shift) setPrefs(index >= from ? { to: index } : { from: index, to: from });
    else setPrefs({ from: index, to: Math.max(index, to) });
  };

  const practiceMeasures = (a: number, b: number) => {
    scorePlayer.dispose();
    setPrefs({ from: Math.max(0, a), to: Math.min(last, b), loops: 0 });
  };

  // 自动标和弦（规格第 10 节第 8 条，M8）
  const allChords = useMemo(() => labelChords(score), [score]);
  const chords = prefs.chords ? allChords : null;
  // 送到进行练习器的和弦序列：这一段小节按演奏顺序，相邻相同的合并
  const chordSeq = useMemo(
    () =>
      chordSequence(
        allChords,
        practiceSequence(score.playback, from, to, prefs.repeats, to === last),
      ),
    [allChords, score, from, to, prefs.repeats, last],
  );
  const practiceChords = () => {
    const s = useSettings.getState();
    s.update({
      progression: {
        ...s.settings.progression,
        progressionId: 'custom',
        custom: chordSeq.join(' '),
      },
    });
    void navigate({ to: '/practice/progression' });
  };

  // 还没开始时瀑布流按当前选项画出这一段
  const displayPlan = useMemo(
    () => buildFollowPlan(score, prefs.hands, from, to, prefs.repeats),
    [score, prefs.hands, from, to, prefs.repeats],
  );

  const measureLabel = (i: number) => score.measures[i]?.number ?? String(i + 1);
  const bpm = effectiveBpm(playScore, prefs.speed);
  const firstMeasure = score.measures[0];

  // 弹奏时视图填满屏幕；选项、结果显示时页面可以滚动，视图用固定高度
  const fill = running;
  // 键盘每个白键最宽约 30 px，免得音域窄时键盘太高；也不超过 --kb-max-h（瀑布流与键盘同宽）
  const keyboardMax = (keyboardLayout(range.low, range.high).width / 24) * 30;
  const views = (
    <>
      {prefs.view === 'staff' && (
        <StaffView
          score={score}
          from={from}
          to={to}
          current={currentIds}
          marks={marks}
          heat={heat}
          chords={chords}
          focusMeasure={focusMeasure}
          onMeasureClick={onMeasureClick}
          active={running}
          title={record.title}
          composer={score.composer}
          className={fill ? 'min-h-0 flex-1' : 'h-[68vh] min-h-[18rem] shrink-0'}
        />
      )}
      <div
        className={cn(
          'overflow-x-auto',
          prefs.view === 'waterfall' && (fill ? 'flex min-h-0 flex-1 flex-col' : 'shrink-0'),
        )}
      >
        <div
          className={cn(
            'mx-auto w-full min-w-[440px]',
            prefs.view === 'waterfall' && fill && 'flex min-h-0 flex-1 flex-col',
          )}
          style={{ maxWidth: `min(${keyboardMax}px, ${keyboardMaxWidth(range.low, range.high)})` }}
        >
          {prefs.view === 'waterfall' && (
            <WaterfallView
              score={score}
              plan={running && plan ? plan : displayPlan}
              low={range.low}
              high={range.high}
              hands={prefs.hands}
              chords={chords}
              className={fill ? 'min-h-[12rem] flex-1' : 'h-[45vh] min-h-[14rem]'}
            />
          )}
          <PlayableKeyboard low={range.low} high={range.high} labels="c" marks={keyMarks} />
        </div>
      </div>
    </>
  );

  return (
    <div
      className={cn(
        'mx-auto flex max-w-6xl flex-col gap-3 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6',
        fill ? 'h-dvh' : 'min-h-dvh',
      )}
    >
      <header className="flex items-center gap-3">
        {running ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => scorePlayer.stop()}
            title={t('scores.stopLabel')}
          >
            <Square className="size-3.5" />
            {t('scores.stop')}
          </Button>
        ) : (
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link to="/scores">
              <ArrowLeft />
              {t('scores.back')}
            </Link>
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold tracking-tight">{record.title}</h1>
          <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">♩ = {playScore.tempo}</span>
            {firstMeasure && (
              <span className="font-mono tabular-nums">
                {firstMeasure.beats}/{firstMeasure.beatType}
              </span>
            )}
            <span>{t('scores.measureCount', { n: score.measures.length })}</span>
          </p>
        </div>
        {running && (
          <span
            className="rounded-full bg-surface-2 px-3 py-1 font-mono text-sm tabular-nums"
            data-testid="play-status"
            data-start-t={clock?.startT}
            data-ms-per-tick={clock?.msPerTick}
          >
            {status === 'starting'
              ? t('scores.preparing')
              : playhead.countIn !== null
                ? t('scores.countIn', { n: playhead.countIn })
                : t('scores.atMeasure', { n: measureLabel(focusMeasure) })}
          </span>
        )}
        <MidiConnectButton />
      </header>

      {status === 'summary' && summary ? (
        <SummaryPanel
          summary={summary}
          from={from}
          to={to}
          label={measureLabel}
          onAgain={start}
          onClose={() => scorePlayer.dispose()}
          onPractice={practiceMeasures}
        />
      ) : running ? (
        <RunningHint mode={prefs.mode} hands={prefs.hands} />
      ) : (
        <SetupPanel
          prefs={prefs}
          setPrefs={setPrefs}
          score={score}
          from={from}
          to={to}
          bpm={bpm}
          label={measureLabel}
          latencyCalibrated={latencyCalibrated}
          worst={worst}
          onPractice={practiceMeasures}
          chordCount={chordSeq.length}
          onPracticeChords={practiceChords}
          onStart={start}
          error={status === 'error' ? error : null}
        />
      )}

      {views}
    </div>
  );
}

function RunningHint({ mode, hands }: { mode: ScorePrefs['mode']; hands: HandsMode }) {
  const { t } = useTranslation();
  return (
    <p className="text-sm text-muted-foreground" aria-live="polite">
      {t(`scores.runningHint.${mode}`, { hands: t(`scores.hands.${hands}`) })}
    </p>
  );
}

/** 工具栏里的一项：上面一行小字标签 */
function Field({
  label,
  value,
  children,
  className,
}: {
  label: string;
  value?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        {value}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <Field label={label} {...(className ? { className } : {})}>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => v && onChange(v as T)}
        aria-label={label}
        className="w-full rounded-lg bg-surface-2 p-0.5"
      >
        {options.map((o) => (
          <ToggleGroupItem
            key={o.value}
            value={o.value}
            className="h-8 flex-1 rounded-md px-3 data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
          >
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  );
}

function MeasureSelect({
  label,
  value,
  min,
  count,
  name,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  count: number;
  name: (i: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 rounded-md border border-border bg-surface-2 px-2 font-mono tabular-nums"
      >
        {Array.from({ length: count - min }, (_, j) => j + min).map((i) => (
          <option key={i} value={i}>
            {name(i)}
          </option>
        ))}
      </select>
    </label>
  );
}

function SetupPanel({
  prefs,
  setPrefs,
  score,
  from,
  to,
  bpm,
  label,
  latencyCalibrated,
  worst,
  onPractice,
  chordCount,
  onPracticeChords,
  onStart,
  error,
}: {
  prefs: ScorePrefs;
  setPrefs: (p: Partial<ScorePrefs>) => void;
  score: Score;
  from: number;
  to: number;
  bpm: number;
  label: (i: number) => string;
  latencyCalibrated: boolean;
  worst: (MeasureStat & { rate: number })[];
  onPractice: (a: number, b: number) => void;
  /** 这一段里自动标出的和弦数（相邻相同的合并后） */
  chordCount: number;
  onPracticeChords: () => void;
  onStart: () => void;
  error: 'empty' | 'audio' | null;
}) {
  const { t } = useTranslation();
  const [more, setMore] = useState(false);
  const count = score.measures.length;
  const notices = [
    ...(error ? [{ key: 'error', icon: TriangleAlert, text: t(`scores.playError.${error}`) }] : []),
    ...score.warnings.map((w) => ({
      key: w.kind,
      icon: TriangleAlert,
      text:
        w.kind === 'parts-ignored'
          ? t('scores.warning.parts-ignored', { parts: w.parts.join(', ') })
          : t(`scores.warning.${w.kind}`, { bpm: score.tempo }),
    })),
  ];
  return (
    <section
      className="rounded-2xl border border-border bg-card shadow-sm"
      aria-label={t('scores.setupLabel')}
      data-testid="score-setup"
    >
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3 p-3 sm:p-4">
        <Segmented
          label={t('scores.mode')}
          value={prefs.mode}
          onChange={(mode) => setPrefs({ mode })}
          className="w-full sm:w-56"
          options={[
            { value: 'wait', label: t('scores.modeWait') },
            { value: 'tempo', label: t('scores.modeTempo') },
            { value: 'listen', label: t('scores.modeListen') },
          ]}
        />
        <Segmented
          label={t('scores.handsLabel')}
          value={prefs.hands}
          onChange={(hands) => setPrefs({ hands })}
          className="w-full sm:w-52"
          options={(['both', 'right', 'left'] as const).map((h) => ({
            value: h,
            label: t(`scores.hands.${h}`),
          }))}
        />
        <Field
          label={t('scores.speed')}
          className="w-full sm:w-48"
          value={
            <span className="font-mono text-foreground tabular-nums">
              {t('scores.speedValue', { pct: Math.round(prefs.speed * 100), bpm })}
            </span>
          }
        >
          <div className="flex h-9 items-center">
            <Slider
              min={25}
              max={150}
              step={5}
              value={[Math.round(prefs.speed * 100)]}
              onValueChange={([v]) => v !== undefined && setPrefs({ speed: v / 100 })}
              aria-label={t('scores.speed')}
            />
          </div>
        </Field>
        <Field label={t('scores.range')}>
          <div className="flex h-9 items-center gap-3">
            <MeasureSelect
              label={t('scores.from')}
              value={from}
              min={0}
              count={count}
              name={label}
              onChange={(v) => setPrefs({ from: v, to: Math.max(v, to) })}
            />
            <MeasureSelect
              label={t('scores.to')}
              value={to}
              min={from}
              count={count}
              name={label}
              onChange={(v) => setPrefs({ to: v === count - 1 ? null : v })}
            />
          </div>
        </Field>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => setMore((m) => !m)}
            aria-expanded={more}
            aria-controls="score-more"
          >
            <SlidersHorizontal />
            {t('scores.more')}
            <ChevronDown
              className={cn(
                'transition-transform duration-[var(--dur-fast)]',
                more && 'rotate-180',
              )}
            />
          </Button>
          <Button size="lg" onClick={onStart} data-testid="score-start">
            <Play />
            {t(`scores.start.${prefs.mode}`)}
          </Button>
        </div>
      </div>

      {more && (
        <div
          id="score-more"
          className="grid gap-x-6 gap-y-4 border-t border-border p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-4"
        >
          <Segmented
            label={t('scores.view')}
            value={prefs.view}
            onChange={(view) => setPrefs({ view })}
            options={[
              { value: 'staff', label: t('scores.viewStaff') },
              { value: 'waterfall', label: t('scores.viewWaterfall') },
            ]}
          />
          <Segmented
            label={t('scores.otherHand')}
            value={prefs.otherHand}
            onChange={(otherHand) => setPrefs({ otherHand })}
            options={[
              { value: 'play', label: t('scores.otherPlay') },
              { value: 'mute', label: t('scores.otherMute') },
            ]}
          />
          <Segmented
            label={t('scores.loops')}
            value={String(prefs.loops)}
            onChange={(v) => setPrefs({ loops: Number(v) })}
            options={[1, 2, 4, 0].map((n) => ({
              value: String(n),
              label: n === 0 ? t('progression.loopsEndless') : t('progression.loopsN', { n }),
            }))}
          />
          <Field
            label={t('scores.baseTempo')}
            value={
              !score.tempoMarked && prefs.baseBpm === null ? (
                <span className="text-warning">{t('scores.tempoUnmarked')}</span>
              ) : undefined
            }
          >
            <BaseTempoInput
              value={prefs.baseBpm ?? score.tempo}
              onChange={(v) =>
                setPrefs({ baseBpm: v === score.tempo && score.tempoMarked ? null : v })
              }
            />
          </Field>
          <div className="space-y-3 sm:col-span-2">
            <SwitchRow
              id="score-metronome"
              label={t('scores.metronome')}
              checked={prefs.metronome}
              onChange={(metronome) => setPrefs({ metronome })}
            />
            <SwitchRow
              id="score-hints"
              label={t('scores.keyHints')}
              checked={prefs.keyHints}
              onChange={(keyHints) => setPrefs({ keyHints })}
            />
          </div>
          <div className="space-y-3 sm:col-span-2">
            <SwitchRow
              id="score-chords"
              label={t('scores.showChords')}
              hint={t('scores.showChordsHint')}
              checked={prefs.chords}
              onChange={(chords) => setPrefs({ chords })}
            />
            {hasRepeats(score) && (
              <SwitchRow
                id="score-repeats"
                label={t('scores.repeats')}
                hint={t('scores.repeatsHint', {
                  n: score.playback.length,
                  m: score.measures.length,
                })}
                checked={prefs.repeats}
                onChange={(repeats) => setPrefs({ repeats })}
              />
            )}
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button
              variant="outline"
              size="sm"
              onClick={onPracticeChords}
              disabled={chordCount < 2}
              title={t('scores.practiceChordsHint')}
              data-testid="practice-chords"
            >
              <Music />
              {t('scores.practiceChords', { n: chordCount })}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2 border-t border-border px-3 py-2.5 text-sm text-muted-foreground sm:px-4">
        <p className="flex items-start gap-2">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {t(`scores.modeHint.${prefs.mode}`)}{' '}
            <span className="text-subtle-foreground">{t('scores.clickMeasureHint')}</span>
          </span>
        </p>
        {prefs.mode === 'tempo' && !latencyCalibrated && (
          <p className="flex gap-2 text-warning">
            <Gauge className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {t('progression.notCalibrated')}{' '}
              <Link to="/settings" hash="latency" className="underline underline-offset-2">
                {t('progression.calibrateLink')}
              </Link>
            </span>
          </p>
        )}
        {notices.map((n) => (
          <p
            key={n.key}
            className={cn('flex items-start gap-2', n.key === 'error' && 'text-warning')}
            role={n.key === 'error' ? 'alert' : undefined}
          >
            <n.icon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {n.text}
          </p>
        ))}
        {worst.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" data-testid="worst-measures">
            <span>{t('scores.worstTitle')}</span>
            {worst.map((m) => (
              <Button
                key={m.measure}
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => onPractice(m.measure, m.measure)}
              >
                {t('scores.measureN', { n: label(m.measure) })}
                <span className="text-muted-foreground tabular-nums">
                  {t('scores.errorRate', { pct: Math.round(m.rate * 100) })}
                </span>
              </Button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** 原速（♩ =）：输入完（失去焦点或回车）才保存 */
function BaseTempoInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(draft));
    if (Number.isFinite(n) && n >= 20 && n <= 300) onChange(n);
    else setDraft(String(value));
  };
  return (
    <label className="flex h-9 items-center gap-2 text-sm">
      <span className="font-mono">♩ =</span>
      <input
        type="number"
        inputMode="numeric"
        min={20}
        max={300}
        value={draft}
        aria-label={t('scores.baseTempo')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className="h-8 w-20 rounded-md border border-border bg-surface-2 px-2 font-mono tabular-nums"
      />
    </label>
  );
}

function SummaryPanel({
  summary,
  from,
  to,
  label,
  onAgain,
  onClose,
  onPractice,
}: {
  summary: FollowSummary;
  from: number;
  to: number;
  label: (i: number) => string;
  onAgain: () => void;
  onClose: () => void;
  onPractice: (a: number, b: number) => void;
}) {
  const { t } = useTranslation();
  const byMeasure = new Map(summary.measures.map((m) => [m.measure, m]));
  const worst = worstMeasures([summary.measures], 3, 1);
  const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
  const accuracy = summary.total ? summary.correct / summary.total : null;
  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-4"
      aria-label={t('scores.summaryTitle')}
      data-testid="score-summary"
    >
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <h2 className="text-lg font-semibold">{t('scores.summaryTitle')}</h2>
        <Stat
          label={summary.mode === 'wait' ? t('scores.firstTry') : t('scores.hit')}
          value={pct(accuracy)}
        />
        {summary.mode === 'tempo' ? (
          <>
            <Stat label={t('scores.missed')} value={String(summary.missed)} />
            <Stat label={t('scores.extra')} value={String(summary.extra)} />
            <Stat label={t('scores.onBeat')} value={pct(summary.onBeatRate)} />
            <Stat
              label={t('scores.meanOffset')}
              value={
                summary.meanOffsetMs === null
                  ? '—'
                  : `${summary.meanOffsetMs > 0 ? '+' : ''}${summary.meanOffsetMs} ms`
              }
            />
          </>
        ) : (
          <Stat label={t('scores.wrongNotes')} value={String(summary.extra)} />
        )}
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">{t('scores.byMeasure')}</p>
        <div className="flex flex-wrap gap-1" data-testid="measure-strip">
          {Array.from({ length: to - from + 1 }, (_, j) => j + from).map((i) => {
            const s = byMeasure.get(i);
            const rate = s ? measureErrorRate(s) : null;
            const text =
              s === undefined
                ? t('scores.cellEmpty', { n: label(i) })
                : t('scores.cell', { n: label(i), errors: s.errors, total: s.total });
            return (
              <button
                key={i}
                type="button"
                onClick={() => onPractice(i, i)}
                title={text}
                aria-label={text}
                className={cn(
                  'grid h-8 min-w-8 place-items-center rounded-md border px-1 font-mono text-xs tabular-nums',
                  rate === null
                    ? 'border-border text-subtle-foreground'
                    : rate === 0
                      ? 'border-mark-correct/40 bg-mark-correct/15'
                      : rate < 0.25
                        ? 'border-warning/50 bg-warning/20'
                        : 'border-mark-extra/50 bg-mark-extra/20 font-semibold',
                )}
              >
                {label(i)}
              </button>
            );
          })}
        </div>
      </div>

      {worst.length > 0 ? (
        <p className="text-sm">
          {t('scores.worstNow', { list: worst.map((m) => label(m.measure)).join(', ') })}{' '}
          <Button
            size="sm"
            variant="link"
            className="h-auto p-0"
            onClick={() => {
              const ms = worst.map((m) => m.measure);
              onPractice(Math.min(...ms), Math.max(...ms));
            }}
          >
            {t('scores.loopThese')}
          </Button>
        </p>
      ) : (
        <p className="text-sm text-mark-correct">{t('scores.allClean')}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={onAgain}>
          <RotateCcw />
          {t('scores.again')}
        </Button>
        <Button variant="outline" onClick={onClose}>
          {t('scores.backToOptions')}
        </Button>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-sm">
      <span className="text-muted-foreground">{label}</span>{' '}
      <span className="font-mono font-medium tabular-nums">{value}</span>
    </span>
  );
}
