import { type BeatGrid, estimateLatency, type LatencyEstimate } from '@mayochord/core';
import { Gauge, RotateCcw, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type Metronome, startMetronome } from '@/audio/metronome';
import { Button } from '@/design/ui/button';
import { Slider } from '@/design/ui/slider';
import { liveInput } from '@/input/live';
import { cn } from '@/lib/utils';
import { useSettings } from '@/stores/settings';

const BPM = 90;
const COUNT_IN = 4;
const BEATS = 16;

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; beat: number; taps: number }
  | { kind: 'done'; estimate: LatencyEstimate | null }
  | { kind: 'error' };

/**
 * 延迟校准（规格 9）：节拍器数 4 拍预备后，跟着每一拍按任意一个键，共 16 拍。
 * 每次按下相对拍点的偏差取中位数（去掉前几下和离群值），之后所有节拍偏差都扣除它。
 */
export function LatencyPanel() {
  const { t } = useTranslation();
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const metronome = useRef<Metronome | null>(null);
  const cleanup = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    cleanup.current?.();
    cleanup.current = null;
    metronome.current?.stop();
    metronome.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const start = async () => {
    stop();
    const taps: number[] = [];
    let grid: BeatGrid | null = null;
    const finish = () => {
      stop();
      if (!grid) return;
      const g = grid;
      const beats = Array.from({ length: BEATS }, (_, i) => g.startT + i * g.beatMs);
      setPhase({ kind: 'done', estimate: estimateLatency(taps, beats) });
    };
    setPhase({ kind: 'running', beat: -COUNT_IN, taps: 0 });
    let m: Metronome;
    try {
      m = await startMetronome({
        bpm: BPM,
        beatsPerBar: 4,
        mode: 'all',
        accent: true,
        countInBeats: COUNT_IN,
        volume: useSettings.getState().settings.metronomeVolume,
        onBeat: (beat) => {
          if (beat >= BEATS) {
            finish();
            return;
          }
          setPhase((p) => (p.kind === 'running' ? { ...p, beat } : p));
        },
      });
    } catch {
      setPhase({ kind: 'error' });
      return;
    }
    metronome.current = m;
    grid = m.grid;
    const from = m.grid.startT - m.grid.beatMs / 2;
    cleanup.current = liveInput.onEvent((e) => {
      if (e.kind !== 'noteOn' || e.t < from) return; // 预备拍里的不算
      taps.push(e.t);
      setPhase((p) => (p.kind === 'running' ? { ...p, taps: taps.length } : p));
    });
  };

  const est = phase.kind === 'done' ? phase.estimate : null;

  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <span className="text-sm">{t('settings.latencyCurrent')}</span>
        <span className="font-mono text-sm tabular-nums" data-testid="latency-value">
          {settings.latencyCalibrated
            ? t('settings.latencyValue', { ms: settings.latencyOffsetMs })
            : t('settings.latencyNone')}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <span className="text-sm">{t('settings.metronomeVolume')}</span>
        <Slider
          className="w-48"
          min={0}
          max={1}
          step={0.05}
          value={[settings.metronomeVolume]}
          onValueChange={([v]) => v !== undefined && update({ metronomeVolume: v })}
          aria-label={t('settings.metronomeVolume')}
        />
      </div>

      {phase.kind === 'running' && (
        <div className="space-y-3 px-4 py-4" role="status">
          <p className="text-sm font-medium text-primary">
            {phase.beat < 0
              ? t('settings.latencyCountIn', { n: -phase.beat })
              : t('settings.latencyTap', { i: phase.beat + 1, n: BEATS })}
          </p>
          <div className="flex flex-wrap gap-1.5" aria-hidden>
            {Array.from({ length: BEATS }, (_, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: 固定的拍
                key={i}
                className={cn(
                  'size-2.5 rounded-full bg-border',
                  i < phase.beat && 'bg-primary/50',
                  i === phase.beat && 'bg-primary',
                )}
              />
            ))}
          </div>
          <p className="font-mono text-xs text-muted-foreground tabular-nums">
            {t('settings.latencyTaps', { n: phase.taps })}
          </p>
        </div>
      )}

      {phase.kind === 'done' && (
        <div className="space-y-2 px-4 py-4" role="status">
          {est?.ok ? (
            <p className="text-sm">
              {t('settings.latencyResult', { ms: est.offsetMs, sd: est.stdevMs, n: est.used })}
            </p>
          ) : (
            <p className="text-sm text-warning">
              {est
                ? t('settings.latencyUnstable', { sd: est.stdevMs, n: est.used })
                : t('settings.latencyNoTaps')}
            </p>
          )}
        </div>
      )}
      {phase.kind === 'error' && (
        <p className="px-4 py-3 text-sm text-warning">{t('progression.audioError')}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        {phase.kind === 'running' ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              stop();
              setPhase({ kind: 'idle' });
            }}
          >
            <Square />
            {t('settings.cancel')}
          </Button>
        ) : (
          <>
            {est?.ok && (
              <Button
                size="sm"
                onClick={() => {
                  update({ latencyOffsetMs: est.offsetMs, latencyCalibrated: true });
                  setPhase({ kind: 'idle' });
                }}
              >
                {t('settings.latencySave', { ms: est.offsetMs })}
              </Button>
            )}
            <Button
              size="sm"
              variant={est?.ok ? 'outline' : 'default'}
              onClick={() => void start()}
            >
              <Gauge />
              {phase.kind === 'done' ? t('settings.latencyRetry') : t('settings.latencyStart')}
            </Button>
            {settings.latencyCalibrated && phase.kind === 'idle' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => update({ latencyOffsetMs: 0, latencyCalibrated: false })}
              >
                <RotateCcw />
                {t('settings.latencyReset')}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
