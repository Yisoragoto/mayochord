import { BUILTIN_PACK } from '@mayochord/content';
import { formatChordSymbol, prettyAccidentals } from '@mayochord/core';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Gauge, Info, TriangleAlert } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChordName } from '@/design/ChordName';
import { Keyboard } from '@/design/keyboard/Keyboard';
import { Button } from '@/design/ui/button';
import { Slider } from '@/design/ui/slider';
import { Switch } from '@/design/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/design/ui/toggle-group';
import { keyboardRange, referenceMarks } from '@/features/chords/voicing-view';
import { MidiConnectButton } from '@/features/midi/MidiDevicePanel';
import { PracticeTabs } from '@/features/practice/PracticeTabs';
import { localize } from '@/lib/localize';
import { useDocumentTitle } from '@/lib/use-document-title';
import { cn } from '@/lib/utils';
import { type ProgressionPrefs, useSettings } from '@/stores/settings';
import {
  DEFAULT_BPM,
  parseCustomSequence,
  type RunChord,
  type RunSource,
  sourceFromProgression,
} from './run-source';
import { VoiceLeading } from './VoiceLeading';

const SOURCES = BUILTIN_PACK.progressions.map(sourceFromProgression);

const nameIsChain = (name: string, source: RunSource) => {
  const strip = (x: string) => prettyAccidentals(x).replace(/[\s–-]/g, '');
  return strip(name) === strip(source.steps.map((s) => formatChordSymbol(s.chord.symbol)).join(''));
};

/** 按设置选出要练的进行（自定义序列解析失败时返回不能用的词） */
export function selectedSource(
  prefs: ProgressionPrefs,
): { ok: true; source: RunSource } | { ok: false; bad: string[] } {
  if (prefs.progressionId === 'custom') {
    return parseCustomSequence(prefs.custom, BUILTIN_PACK, prefs.beatsPerChord || 4);
  }
  const source = SOURCES.find((s) => s.id === prefs.progressionId) ?? SOURCES[0];
  return source ? { ok: true, source } : { ok: false, bad: [] };
}

export const bpmFor = (prefs: ProgressionPrefs, sourceId: string) =>
  prefs.bpm[sourceId] ?? DEFAULT_BPM;

export function useProgressionPrefs() {
  const prefs = useSettings((s) => s.settings.progression);
  const update = useSettings((s) => s.update);
  const set = (patch: Partial<ProgressionPrefs>) => update({ progression: { ...prefs, ...patch } });
  return [prefs, set] as const;
}

export function ProgressionSetupPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('progression.title'));
  const [prefs, set] = useProgressionPrefs();
  const latency = useSettings((s) => s.settings.latencyCalibrated);
  const selected = useMemo(() => selectedSource(prefs), [prefs]);
  const sourceId =
    prefs.progressionId === 'custom' ? 'custom' : selected.ok ? selected.source.id : '';
  const bpm = bpmFor(prefs, sourceId);
  const setBpm = (v: number) => set({ bpm: { ...prefs.bpm, [sourceId]: v } });

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <PracticeTabs current="progression" />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-cjk-heading text-2xl font-semibold tracking-tight sm:text-3xl">
              {t('progression.title')}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {t('progression.subtitle')}
            </p>
          </div>
          <MidiConnectButton />
        </div>
      </header>

      {/* 手机上的顺序：选进行 → 选项与开始 → 声部进行预览；宽屏时选项在右侧一栏 */}
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
          <fieldset className="space-y-3">
            <legend className="mb-3 text-sm font-medium text-muted-foreground">
              {t('progression.choose')}
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {BUILTIN_PACK.progressions.map((p, i) => (
                <SourceCard
                  key={p.id}
                  id={p.id}
                  selected={prefs.progressionId === p.id}
                  onSelect={() => set({ progressionId: p.id })}
                  title={localize(p.name)}
                  hideTitle={nameIsChain(p.name['zh-CN'], SOURCES[i] as RunSource)}
                >
                  <ChordChain chords={(SOURCES[i] as RunSource).steps.map((s) => s.chord)} />
                </SourceCard>
              ))}
              <SourceCard
                id="custom"
                selected={prefs.progressionId === 'custom'}
                onSelect={() => set({ progressionId: 'custom' })}
                title={t('progression.custom')}
              >
                <span className="text-sm text-muted-foreground">{t('progression.customHint')}</span>
              </SourceCard>
            </div>
            {prefs.progressionId === 'custom' && (
              <div className="space-y-2">
                <input
                  type="text"
                  value={prefs.custom}
                  onChange={(e) => set({ custom: e.target.value })}
                  aria-label={t('progression.customLabel')}
                  placeholder="FM7 E7 Am7 Gm7 C7(9)"
                  spellCheck={false}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-base outline-none focus-visible:border-primary"
                />
                {!selected.ok && (
                  <p className="flex items-center gap-2 text-sm text-warning">
                    <TriangleAlert className="size-4 shrink-0" aria-hidden />
                    {selected.bad.length > 0
                      ? t('progression.customBad', { tokens: selected.bad.join(' ') })
                      : t('progression.customEmpty')}
                  </p>
                )}
                {selected.ok && selected.source.steps.some((s) => s.chord.generated) && (
                  <p className="text-sm text-muted-foreground">
                    {t('progression.customGenerated')}
                  </p>
                )}
              </div>
            )}
          </fieldset>
        </div>

        <div className="space-y-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <Option
            label={t('progression.bpm')}
            value={<span className="font-mono tabular-nums">{bpm}</span>}
          >
            <Slider
              min={40}
              max={180}
              step={1}
              value={[bpm]}
              onValueChange={([v]) => v !== undefined && setBpm(v)}
              aria-label={t('progression.bpm')}
            />
          </Option>

          <Option label={t('progression.beatsPerChord')}>
            <ToggleGroup
              type="single"
              value={String(prefs.beatsPerChord)}
              onValueChange={(v) => v && set({ beatsPerChord: Number(v) })}
              aria-label={t('progression.beatsPerChord')}
              className="w-full rounded-md border border-border p-0.5"
            >
              {[0, 1, 2, 4].map((n) => (
                <ToggleGroupItem key={n} value={String(n)} className="flex-1 tabular-nums">
                  {n === 0 ? t('progression.beatsAsWritten') : t('progression.beatsN', { n })}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Option>

          <Option label={t('progression.click')}>
            <ToggleGroup
              type="single"
              value={prefs.clickMode}
              onValueChange={(v) => v && set({ clickMode: v as ProgressionPrefs['clickMode'] })}
              aria-label={t('progression.click')}
              className="w-full rounded-md border border-border p-0.5"
            >
              <ToggleGroupItem value="all" className="flex-1">
                {t('progression.clickAll')}
              </ToggleGroupItem>
              <ToggleGroupItem value="backbeat" className="flex-1">
                {t('progression.clickBackbeat')}
              </ToggleGroupItem>
              <ToggleGroupItem value="off" className="flex-1">
                {t('progression.clickOff')}
              </ToggleGroupItem>
            </ToggleGroup>
          </Option>

          <Option label={t('progression.mode')}>
            <ToggleGroup
              type="single"
              value={prefs.voicingMode}
              onValueChange={(v) => v && set({ voicingMode: v as ProgressionPrefs['voicingMode'] })}
              aria-label={t('progression.mode')}
              className="w-full rounded-md border border-border p-0.5"
            >
              <ToggleGroupItem value="any" className="flex-1">
                {t('practice.modeAny')}
              </ToggleGroupItem>
              <ToggleGroupItem value="reference" className="flex-1">
                {t('practice.modeReference')}
              </ToggleGroupItem>
            </ToggleGroup>
          </Option>

          <Option label={t('progression.loops')}>
            <ToggleGroup
              type="single"
              value={String(prefs.loops)}
              onValueChange={(v) => v && set({ loops: Number(v) })}
              aria-label={t('progression.loops')}
              className="w-full rounded-md border border-border p-0.5"
            >
              {[2, 4, 8, 0].map((n) => (
                <ToggleGroupItem key={n} value={String(n)} className="flex-1 tabular-nums">
                  {n === 0 ? t('progression.loopsEndless') : t('progression.loopsN', { n })}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Option>

          <div className="space-y-3">
            <SwitchRow
              id="pr-accent"
              label={t('progression.accent')}
              checked={prefs.accent}
              onChange={(v) => set({ accent: v })}
            />
            <SwitchRow
              id="pr-hide"
              label={t('progression.hideVoicings')}
              hint={t('progression.hideVoicingsHint')}
              checked={prefs.hideVoicings}
              onChange={(v) => set({ hideVoicings: v })}
            />
            <SwitchRow
              id="pr-adaptive"
              label={t('progression.adaptive')}
              hint={t('progression.adaptiveHint')}
              checked={prefs.adaptiveBpm}
              onChange={(v) => set({ adaptiveBpm: v })}
            />
          </div>

          {!latency && (
            <p className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              <Gauge className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {t('progression.notCalibrated')}{' '}
                <Link to="/settings" hash="latency" className="underline underline-offset-2">
                  {t('progression.calibrateLink')}
                </Link>
              </span>
            </p>
          )}

          <Button asChild={selected.ok} size="lg" className="w-full" disabled={!selected.ok}>
            {selected.ok ? (
              <Link to="/practice/progression/run">
                {t('progression.start')}
                <ArrowRight />
              </Link>
            ) : (
              <span>{t('progression.start')}</span>
            )}
          </Button>

          <div className="flex gap-2 rounded-lg border border-border bg-surface-2/50 p-3 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{t('progression.howItWorks')}</p>
          </div>
        </div>

        {selected.ok && (
          <div className="min-w-0 lg:col-start-1 lg:row-start-2">
            <VoiceLeadingPreview source={selected.source} />
          </div>
        )}
      </div>
    </div>
  );
}

function SourceCard({
  id,
  title,
  selected,
  onSelect,
  hideTitle = false,
  children,
}: {
  id: string;
  title: string;
  /** 名字就是和弦序列本身（例如"C – G – Am – F"）时不重复显示 */
  hideTitle?: boolean;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer flex-col gap-2 rounded-xl border bg-card p-4 transition-colors duration-[var(--dur-fast)]',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
        selected
          ? 'border-primary bg-primary/8 shadow-[inset_0_0_0_1px_var(--primary)]'
          : 'border-border hover:border-border-strong',
      )}
    >
      <input
        type="radio"
        name="progression-source"
        value={id}
        checked={selected}
        onChange={onSelect}
        aria-label={title}
        className="sr-only"
      />
      {!hideTitle && <span className="font-medium">{title}</span>}
      {children}
    </label>
  );
}

export function ChordChain({ chords }: { chords: readonly RunChord[] }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
      {chords.map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 进行里同一个和弦可能出现多次
        <span key={`${c.id}-${i}`} className="inline-flex items-baseline gap-1.5">
          {i > 0 && <span className="text-subtle-foreground">–</span>}
          <ChordName symbol={c.symbol} size="sm" />
        </span>
      ))}
    </span>
  );
}

/** 进行里每一次切换的声部进行（含回到开头的那一次） */
function VoiceLeadingPreview({ source }: { source: RunSource }) {
  const { t } = useTranslation();
  const steps = source.steps;
  const range = useMemo(
    () => keyboardRange(steps.flatMap((s) => s.chord.notes.map((n) => n.midi))),
    [steps],
  );
  const pairs =
    steps.length < 2 ? [] : steps.map((s, i) => [s, steps[(i + 1) % steps.length]] as const);
  if (pairs.length === 0) return null;
  return (
    <section className="space-y-3" aria-labelledby="vl-heading">
      <div>
        <h2 id="vl-heading" className="text-sm font-medium text-muted-foreground">
          {t('progression.voiceLeading')}
        </h2>
        <p className="text-sm text-subtle-foreground">{t('progression.voiceLeadingHint')}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {pairs.map(([a, b], i) =>
          b ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: 同一对和弦可能出现多次
            <figure key={i} className="space-y-1 rounded-xl border border-border bg-card p-3">
              <figcaption className="flex items-baseline gap-2">
                <ChordName symbol={a.chord.symbol} size="sm" />
                <ArrowRight className="size-3.5 self-center text-subtle-foreground" aria-hidden />
                <ChordName symbol={b.chord.symbol} size="sm" />
              </figcaption>
              <VoiceLeading
                from={a.chord.notes}
                to={b.chord.notes}
                low={range.low}
                high={range.high}
              />
              <Keyboard
                low={range.low}
                high={range.high}
                labels="none"
                marks={referenceMarks({
                  id: '',
                  chordId: b.chord.id,
                  notes: [...b.chord.notes],
                  status: 'generated',
                })}
                aria-label={t('progression.keyboardOf', {
                  name: prettyAccidentals(formatChordSymbol(b.chord.symbol)),
                })}
              />
            </figure>
          ) : null,
        )}
      </div>
    </section>
  );
}

export function Option({
  label,
  value,
  children,
}: {
  label: string;
  value?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-sm font-medium text-muted-foreground">
        <span>{label}</span>
        {value}
      </div>
      {children}
    </div>
  );
}

export function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <label htmlFor={id} className="text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-muted-foreground">{hint}</span>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
