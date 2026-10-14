import {
  type InputEvent,
  identifyChord,
  midiBytesToHex,
  midiToName,
  prettyAccidentals,
} from '@mayochord/core';
import { Check, Copy, Download, Pause, Play, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChordName } from '@/design/ChordName';
import { Badge } from '@/design/ui/badge';
import { Button } from '@/design/ui/button';
import { Label } from '@/design/ui/label';
import { Switch } from '@/design/ui/switch';
import { MidiDevicePanel } from '@/features/midi/MidiDevicePanel';
import { useLiveInput } from '@/input/live';
import { PlayableKeyboard } from '@/input/PlayableKeyboard';
import { type RawMidiMessage, useMidi, webMidi } from '@/input/webmidi';
import { cn } from '@/lib/utils';
import { useSettings } from '@/stores/settings';
import { type LogEntry, parseRaw, SummaryAccumulator } from './recorder';

const MAX_LOG = 200;
const MAX_CAPTURE = 50_000;

interface Session {
  log: LogEntry[];
  capture: RawMidiMessage[];
  acc: SummaryAccumulator;
  nextId: number;
  startedAt: string;
  /** 用户点击测试清单步骤时插入的标记，导出后可以把消息对应到具体步骤 */
  markers: { t: number; step: number; label: string }[];
}

function newSession(): Session {
  return {
    log: [],
    capture: [],
    acc: new SummaryAccumulator(),
    nextId: 0,
    startedAt: new Date().toISOString(),
    markers: [],
  };
}

function useMonitorSession(paused: boolean) {
  const session = useRef<Session>(newSession());
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [, setFrame] = useState(0);

  useEffect(() => {
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setFrame((f) => f + 1);
      });
    };
    const off = webMidi.onRaw((raw) => {
      const s = session.current;
      const parsed = parseRaw(raw);
      if (s.capture.length < MAX_CAPTURE) s.capture.push(raw);
      s.acc.add(raw, parsed);
      if (!pausedRef.current) {
        s.log.push({ id: s.nextId++, raw, parsed });
        if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
      }
      schedule();
    });
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, []);

  const reset = useCallback(() => {
    session.current = newSession();
    setFrame((f) => f + 1);
  }, []);
  const clearLog = useCallback(() => {
    session.current.log = [];
    setFrame((f) => f + 1);
  }, []);

  const mark = useCallback((step: number, label: string) => {
    session.current.markers.push({ t: performance.now(), step, label });
    setFrame((f) => f + 1);
  }, []);

  return { session: session.current, reset, clearLog, mark };
}

export function MonitorPage() {
  const { t } = useTranslation();
  const midi = useMidi();
  const [paused, setPaused] = useState(false);
  const [showRealtime, setShowRealtime] = useState(false);
  const { session, reset, clearLog, mark } = useMonitorSession(paused);
  const sustainCounts = useSettings((s) => s.settings.sustainCountsAsHeld);
  const updateSettings = useSettings((s) => s.update);
  // 按住的音来自输入汇流：已扣除校准偏移、已合并 DUAL 的重复通道，也包括屏幕键盘和电脑键盘
  const held = useLiveInput((s) => s.held);
  const heldInfo = useLiveInput((s) => s.notes);
  const sustainDown = useLiveInput((s) => s.sustainDown);
  const candidates = useMemo(() => identifyChord(held), [held]);
  const summary = session.acc.snapshot();

  const exportJson = () =>
    JSON.stringify(
      {
        app: 'MayoChord',
        kind: 'midi-monitor-capture',
        formatVersion: 2,
        startedAt: session.startedAt,
        exportedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        // 导出时重新读取端口状态，避免 store 里的快照过时
        ports: { ...webMidi.portSnapshot(), selectedInputId: midi.selectedInputId },
        openError: midi.openError,
        settings: { sustainCountsAsHeld: sustainCounts },
        summary,
        markers: session.markers,
        messages: session.capture,
      },
      null,
      1,
    );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-cjk-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            {t('monitor.title')}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('monitor.subtitle')}</p>
        </div>
      </header>

      <MidiDevicePanel />

      <section
        aria-label={t('monitor.chord')}
        className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
      >
        <div className="flex min-h-40 flex-col justify-between gap-4">
          <div>
            <p className="text-xs tracking-wide text-muted-foreground">{t('monitor.chord')}</p>
            <div className="mt-2 min-h-[1em] text-[length:var(--text-chord-lg)]" aria-live="polite">
              {candidates[0] ? (
                <ChordName symbol={candidates[0].symbol} size="lg" />
              ) : (
                <span className="font-display-chord text-subtle-foreground">
                  {t('monitor.noChord')}
                </span>
              )}
            </div>
            {candidates.length > 1 && (
              <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span>{t('monitor.alternatives')}</span>
                {candidates.slice(1, 5).map((c) => (
                  <ChordName
                    key={`${c.symbol.root}-${c.symbol.quality}-${c.symbol.bass}`}
                    symbol={c.symbol}
                    size="sm"
                    className="text-foreground"
                  />
                ))}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  'size-2.5 rounded-full border border-border-strong transition-colors',
                  sustainDown && 'border-primary bg-primary',
                )}
              />
              {t('monitor.sustain')}：
              {sustainDown ? t('monitor.sustainDown') : t('monitor.sustainUp')}
            </span>
            <span className="inline-flex items-center gap-2">
              <Switch
                id="sustain-counts"
                checked={sustainCounts}
                onCheckedChange={(v) => updateSettings({ sustainCountsAsHeld: v })}
              />
              <Label htmlFor="sustain-counts" className="font-normal text-muted-foreground">
                {t('settings.sustainCounts')}
              </Label>
            </span>
          </div>
        </div>

        <div>
          <p className="text-xs tracking-wide text-muted-foreground">
            {t('monitor.held')}
            <span className="ml-2 text-subtle-foreground">{t('monitor.heldHint')}</span>
          </p>
          <ul className="mt-2 flex min-h-12 flex-wrap gap-2">
            {held.length === 0 && (
              <li className="text-sm text-subtle-foreground">{t('monitor.nothingHeld')}</li>
            )}
            {held.map((n) => {
              const info = heldInfo.get(n);
              return (
                <li
                  key={n}
                  className={cn(
                    'rounded-md border border-border bg-surface-2 px-2.5 py-1.5 tabular',
                    info?.sustained && 'border-dashed opacity-70',
                  )}
                >
                  <span className="font-semibold">{prettyAccidentals(midiToName(n))}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    #{n} · ch{info?.channel} · v{info?.velocity}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="overflow-x-auto lg:col-span-2">
          <PlayableKeyboard low={21} high={108} labels="c" className="min-w-[720px]" />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <SummaryPanel
          summary={summary}
          captured={session.capture.length}
          onReset={reset}
          exportJson={exportJson}
        />
        <Checklist
          current={session.markers.at(-1)?.step ?? null}
          onStart={(step, label) => mark(step, label)}
        />
      </div>

      <section aria-labelledby="log-title" className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <h2 id="log-title" className="font-semibold">
            {t('monitor.log')}
            <span className="ml-2 text-xs font-normal text-subtle-foreground">
              {t('monitor.logHint')}
            </span>
          </h2>
          {paused && <Badge variant="secondary">{t('monitor.paused')}</Badge>}
          <span className="ml-auto inline-flex items-center gap-2 text-sm">
            <Switch id="show-rt" checked={showRealtime} onCheckedChange={setShowRealtime} />
            <Label htmlFor="show-rt" className="font-normal text-muted-foreground">
              {t('monitor.showRealtime')}
            </Label>
          </span>
          <Button size="sm" variant="outline" onClick={() => setPaused((p) => !p)}>
            {paused ? <Play /> : <Pause />}
            {paused ? t('monitor.resume') : t('monitor.pause')}
          </Button>
          <Button size="sm" variant="ghost" onClick={clearLog}>
            <Trash2 />
            {t('monitor.clearLog')}
          </Button>
        </div>
        <LogTable entries={session.log} showRealtime={showRealtime} />
      </section>
    </div>
  );
}

function SummaryPanel({
  summary: s,
  captured,
  onReset,
  exportJson,
}: {
  summary: ReturnType<SummaryAccumulator['snapshot']>;
  captured: number;
  onReset: () => void;
  exportJson: () => string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const range = (a: number | null, b: number | null, fmt: (n: number) => string = String) =>
    a === null || b === null ? '—' : `${fmt(a)} – ${fmt(b)}`;
  const noteFmt = (n: number) => `${prettyAccidentals(midiToName(n))} (${n})`;
  const otherCc = Object.entries(s.otherCc)
    .map(([cc, n]) => `CC${cc}×${n}`)
    .join(' ');

  const rows: [string, string][] = [
    [t('monitor.messages'), String(s.total)],
    [t('monitor.channels'), s.channels.length ? s.channels.join(', ') : '—'],
    [t('monitor.noteRange'), range(s.noteMin, s.noteMax, noteFmt)],
    [t('monitor.velocityRange'), range(s.velocityMin, s.velocityMax)],
    [
      t('monitor.noteOffStyle'),
      s.noteOffAs80 + s.noteOffAsNoteOnZero === 0
        ? '—'
        : `8n: ${s.noteOffAs80} · 9n v0: ${s.noteOffAsNoteOnZero}`,
    ],
    [t('monitor.cc64Values'), s.cc64Values.length ? s.cc64Values.join(', ') : '—'],
    [t('monitor.otherCc'), otherCc || '—'],
    [t('monitor.activeSensing'), t('monitor.count', { count: s.activeSensing })],
    [
      t('monitor.clock'),
      s.clock === 0
        ? '—'
        : `${t('monitor.count', { count: s.clock })}${s.clockBpm ? ` · ${t('monitor.clockBpm', { bpm: s.clockBpm })}` : ''} · start ${s.startStop.start} / stop ${s.startStop.stop}`,
    ],
    [
      t('monitor.programChanges'),
      s.programChanges.length
        ? s.programChanges.map((p) => `ch${p.channel}:${p.program}`).join(' ')
        : '—',
    ],
    [
      t('monitor.latency'),
      s.latencyMs
        ? `${s.latencyMs.mean.toFixed(2)} ms（${s.latencyMs.min.toFixed(2)} – ${s.latencyMs.max.toFixed(2)}）`
        : '—',
    ],
  ];

  const download = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mayochord-midi-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportJson());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* 剪贴板不可用时用下载 */
    }
  };

  return (
    <section
      aria-labelledby="summary-title"
      className="rounded-xl border border-border bg-card p-4 sm:p-6"
    >
      <h2 id="summary-title" className="font-semibold">
        {t('monitor.summary')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('monitor.summaryHint')}</p>
      <dl className="mt-4 divide-y divide-border text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[9.5rem_1fr] gap-3 py-2">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-mono text-[13px] break-words tabular">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={download} disabled={captured === 0}>
          <Download />
          {t('monitor.download')}
        </Button>
        <Button variant="outline" onClick={() => void copy()} disabled={captured === 0}>
          {copied ? <Check /> : <Copy />}
          {copied ? t('monitor.copied') : t('monitor.copy')}
        </Button>
        <Button variant="ghost" onClick={onReset}>
          <RotateCcw />
          {t('monitor.reset')}
        </Button>
      </div>
    </section>
  );
}

function Checklist({
  current,
  onStart,
}: {
  current: number | null;
  onStart: (step: number, label: string) => void;
}) {
  const { t } = useTranslation();
  const steps = t('monitor.checklistSteps', { returnObjects: true }) as readonly string[];
  return (
    <section
      aria-labelledby="checklist-title"
      className="rounded-xl border border-border bg-card p-4 sm:p-6"
    >
      <h2 id="checklist-title" className="font-semibold">
        {t('monitor.checklist')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('monitor.checklistHint')}</p>
      <ol className="mt-4 space-y-1 text-sm leading-relaxed">
        {steps.map((s, i) => {
          const step = i + 1;
          const active = current === step;
          return (
            <li key={s}>
              <button
                type="button"
                onClick={() => onStart(step, s)}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'grid w-full grid-cols-[1.75rem_1fr] gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2',
                  active && 'bg-surface-2 ring-1 ring-primary',
                )}
              >
                <span className="font-mono text-xs leading-6 text-primary tabular">
                  {String(step).padStart(2, '0')}
                </span>
                <span>{s}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const REALTIME = new Set<InputEvent['kind']>(['clock', 'start', 'stop', 'continue']);

function describe(e: InputEvent | null, raw: RawMidiMessage) {
  if (!e) {
    const st = raw.data[0] ?? 0;
    return { type: st === 0xfe ? 'active sensing' : 'ignored', channel: '', note: '', value: '' };
  }
  switch (e.kind) {
    case 'noteOn':
    case 'noteOff':
      return {
        type: e.kind,
        channel: String(e.channel),
        note: `${prettyAccidentals(midiToName(e.note))} (${e.note})`,
        value: String(e.velocity),
      };
    case 'sustain':
      return { type: 'sustain CC64', channel: String(e.channel), note: '', value: String(e.value) };
    case 'cc':
      return {
        type: `CC${e.controller}`,
        channel: String(e.channel),
        note: '',
        value: String(e.value),
      };
    case 'polyPressure':
      return {
        type: e.kind,
        channel: String(e.channel),
        note: e.note === undefined ? '' : midiToName(e.note),
        value: String(e.value),
      };
    case 'programChange':
    case 'pitchBend':
    case 'channelPressure':
      return { type: e.kind, channel: String(e.channel), note: '', value: String(e.value) };
    default:
      return { type: e.kind, channel: '', note: '', value: '' };
  }
}

function LogTable({ entries, showRealtime }: { entries: LogEntry[]; showRealtime: boolean }) {
  const { t } = useTranslation();
  const visible = entries
    .filter(
      (e) => showRealtime || !(e.parsed ? REALTIME.has(e.parsed.kind) : e.raw.data[0] === 0xfe),
    )
    .slice(-120)
    .reverse();
  const t0 = entries[0]?.raw.t ?? 0;
  return (
    <div className="max-h-[28rem] overflow-auto">
      <table className="w-full min-w-[640px] text-left font-mono text-[13px] tabular">
        <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
          <tr className="border-b border-border">
            <th className="px-4 py-2 font-normal">{t('monitor.colTime')}</th>
            <th className="px-4 py-2 font-normal">{t('monitor.colRaw')}</th>
            <th className="px-4 py-2 font-normal">{t('monitor.colType')}</th>
            <th className="px-4 py-2 font-normal">{t('monitor.colChannel')}</th>
            <th className="px-4 py-2 font-normal">{t('monitor.colNote')}</th>
            <th className="px-4 py-2 font-normal">{t('monitor.colValue')}</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(({ id, raw, parsed }) => {
            const d = describe(parsed, raw);
            return (
              <tr key={id} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-1.5 text-muted-foreground">{(raw.t - t0).toFixed(1)}</td>
                <td className="px-4 py-1.5">{midiBytesToHex(raw.data)}</td>
                <td className={cn('px-4 py-1.5', parsed?.kind === 'noteOn' && 'text-primary')}>
                  {d.type}
                </td>
                <td className="px-4 py-1.5">{d.channel}</td>
                <td className="px-4 py-1.5">{d.note}</td>
                <td className="px-4 py-1.5">{d.value}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
