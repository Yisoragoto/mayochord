import {
  type FollowSummary,
  type HandsMode,
  type MeasureStat,
  measureErrorRate,
  parseScoreSource,
  type Score,
  worstMeasures,
} from '@mayochord/core';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Gauge, Info, Play, RotateCcw, Square, TriangleAlert } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type KeyMark, keyboardLayout } from '@/design/keyboard/Keyboard';
import { Button } from '@/design/ui/button';
import { Slider } from '@/design/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/design/ui/toggle-group';
import { keyboardRange } from '@/features/chords/voicing-view';
import { MidiConnectButton } from '@/features/midi/MidiDevicePanel';
import { CenteredMessage } from '@/features/practice/SessionRunner';
import { Option, SwitchRow } from '@/features/progression/ProgressionSetupPage';
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

  const start = useCallback(() => {
    void scorePlayer.start({
      scoreId: record.id,
      score,
      mode: prefs.mode,
      hands: prefs.hands,
      otherHand: prefs.otherHand,
      from,
      to,
      speed: prefs.speed,
      loops: prefs.loops === 0 ? null : prefs.loops,
      metronome: prefs.metronome,
      latencyMs: useSettings.getState().settings.latencyOffsetMs,
    });
  }, [record.id, score, prefs, from, to]);

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

  const measureLabel = (i: number) => score.measures[i]?.number ?? String(i + 1);
  const bpm = effectiveBpm(score, prefs.speed);

  // 弹奏时视图填满屏幕；选项、结果显示时页面可以滚动，视图用固定高度
  const fill = running;
  // 键盘每个白键最宽约 30 px，免得音域窄时键盘太高
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
          focusMeasure={focusMeasure}
          onMeasureClick={onMeasureClick}
          className={fill ? 'min-h-0 flex-1' : 'h-[55vh] min-h-[16rem] shrink-0'}
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
          style={{ maxWidth: keyboardMax }}
        >
          {prefs.view === 'waterfall' && (
            <WaterfallView
              score={score}
              low={range.low}
              high={range.high}
              hands={prefs.hands}
              from={from}
              to={to}
              restTick={score.measures[from]?.start ?? 0}
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
      <div className="flex items-center gap-3">
        {running ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => scorePlayer.stop()}
            title={t('scores.stopLabel')}
          >
            <Square className="size-3.5" />
            {t('scores.stop')}
          </Button>
        ) : (
          <Button asChild variant="ghost" size="sm">
            <Link to="/scores">
              <ArrowLeft />
              {t('scores.back')}
            </Link>
          </Button>
        )}
        <h1 className="min-w-0 flex-1 truncate font-medium">{record.title}</h1>
        {running && (
          <span
            className="font-mono text-sm text-muted-foreground tabular-nums"
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
      </div>

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

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <Option label={label}>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => v && onChange(v as T)}
        aria-label={label}
        className="w-full rounded-md border border-border p-0.5"
      >
        {options.map((o) => (
          <ToggleGroupItem key={o.value} value={o.value} className="flex-1">
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Option>
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
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 rounded-md border border-border-strong bg-card px-2 font-mono tabular-nums"
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
  onStart: () => void;
  error: 'empty' | 'audio' | null;
}) {
  const { t } = useTranslation();
  const count = score.measures.length;
  return (
    <div
      className="space-y-4 rounded-xl border border-border bg-card p-4"
      data-testid="score-setup"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          label={t('scores.mode')}
          value={prefs.mode}
          onChange={(mode) => setPrefs({ mode })}
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
          options={(['both', 'right', 'left'] as const).map((h) => ({
            value: h,
            label: t(`scores.hands.${h}`),
          }))}
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Option label={t('scores.range')}>
          <div className="flex flex-wrap items-center gap-3">
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
        </Option>
        <Option
          label={t('scores.speed')}
          value={
            <span className="font-mono tabular-nums">
              {t('scores.speedValue', { pct: Math.round(prefs.speed * 100), bpm })}
            </span>
          }
        >
          <Slider
            min={25}
            max={150}
            step={5}
            value={[Math.round(prefs.speed * 100)]}
            onValueChange={([v]) => v !== undefined && setPrefs({ speed: v / 100 })}
            aria-label={t('scores.speed')}
          />
        </Option>
        <Segmented
          label={t('scores.loops')}
          value={String(prefs.loops)}
          onChange={(v) => setPrefs({ loops: Number(v) })}
          options={[1, 2, 4, 0].map((n) => ({
            value: String(n),
            label: n === 0 ? t('progression.loopsEndless') : t('progression.loopsN', { n }),
          }))}
        />
        <div className="space-y-3">
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
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={onStart} data-testid="score-start">
          <Play />
          {t(`scores.start.${prefs.mode}`)}
        </Button>
        <p className="flex min-w-0 flex-1 items-start gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t(`scores.modeHint.${prefs.mode}`)}
        </p>
      </div>

      {error && (
        <p className="text-sm text-warning" role="alert">
          {t(`scores.playError.${error}`)}
        </p>
      )}
      {prefs.mode === 'tempo' && !latencyCalibrated && (
        <p className="flex gap-2 text-sm text-warning">
          <Gauge className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {t('progression.notCalibrated')}{' '}
            <Link to="/settings" hash="latency" className="underline underline-offset-2">
              {t('progression.calibrateLink')}
            </Link>
          </span>
        </p>
      )}
      {score.warnings.length > 0 && (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {score.warnings.map((w) => (
            <li key={w.kind} className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {w.kind === 'parts-ignored'
                ? t('scores.warning.parts-ignored', { parts: w.parts.join(', ') })
                : t(`scores.warning.${w.kind}`, { bpm: score.tempo })}
            </li>
          ))}
        </ul>
      )}
      {worst.length > 0 && (
        <div className="space-y-2" data-testid="worst-measures">
          <p className="text-sm font-medium">{t('scores.worstTitle')}</p>
          <div className="flex flex-wrap gap-2">
            {worst.map((m) => (
              <Button
                key={m.measure}
                size="sm"
                variant="outline"
                onClick={() => onPractice(m.measure, m.measure)}
              >
                {t('scores.measureN', { n: label(m.measure) })}
                <span className="text-muted-foreground tabular-nums">
                  {t('scores.errorRate', { pct: Math.round(m.rate * 100) })}
                </span>
              </Button>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-subtle-foreground">{t('scores.clickMeasureHint')}</p>
    </div>
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
