import { BUILTIN_DEVICE_PROFILES } from '@mayochord/content';
import {
  DEFAULT_ATTEMPT_OPTIONS,
  type DeviceProfile,
  matchesDevice,
  midiToName,
  prettyAccidentals,
} from '@mayochord/core';
import { Link } from '@tanstack/react-router';
import { Keyboard as KeyboardIcon, Music2, Piano, RotateCcw, Ruler } from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { calibration } from '@/app/bootstrap';
import { Button } from '@/design/ui/button';
import { Label } from '@/design/ui/label';
import { Slider } from '@/design/ui/slider';
import { Switch } from '@/design/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/design/ui/toggle-group';
import { MidiDevicePanel } from '@/features/midi/MidiDevicePanel';
import { ThemeSwitcher } from '@/features/shell/ThemeSwitcher';
import { useCalibration } from '@/input/calibration';
import { useComputerKeyboard } from '@/input/computer-keyboard';
import { useDocumentTitle } from '@/lib/use-document-title';
import { type AppSettings, useSettings } from '@/stores/settings';

const noteName = (n: number) => prettyAccidentals(midiToName(n));

export function SettingsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('settings.title'));
  return (
    <div className="max-w-3xl space-y-8">
      <header>
        <h1 className="font-cjk-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('settings.title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.subtitle')}</p>
      </header>

      <Section title={t('settings.midiTitle')}>
        <MidiDevicePanel />
      </Section>
      <Section title={t('settings.calibrationTitle')} hint={t('settings.calibrationHint')}>
        <CalibrationPanel />
      </Section>
      <Section title={t('settings.inputTitle')}>
        <InputPanel />
      </Section>
      <Section title={t('settings.judgeTitle')} hint={t('settings.judgeHint')}>
        <JudgePanel />
      </Section>
      <Section title={t('settings.appearanceTitle')}>
        <ThemeSwitcher />
      </Section>
      <Section title={t('settings.aboutTitle')}>
        <AboutPanel />
      </Section>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div>
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {hint && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
      {children}
    </div>
  );
}

function CalibrationPanel() {
  const { t } = useTranslation();
  const { deviceKey, record, mode } = useCalibration();
  if (!deviceKey) {
    return (
      <p className="rounded-xl border border-dashed border-border-strong p-4 text-sm text-muted-foreground">
        {t('settings.noDevice')}
      </p>
    );
  }
  const profile: DeviceProfile | undefined = BUILTIN_DEVICE_PROFILES.find((p) =>
    matchesDevice(p, deviceKey),
  );
  const offset = record?.noteOffset ?? 0;
  const lo = record?.lowestNote ?? null;
  const hi = record?.highestNote ?? null;
  const prompt =
    mode === 'octave'
      ? t('settings.waitingC')
      : mode === 'low'
        ? t('settings.waitingLow')
        : mode === 'high'
          ? t('settings.waitingHigh')
          : null;
  const matches =
    lo !== null && hi !== null && profile?.lowestNote === lo && profile.highestNote === hi;

  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-card">
      <Row>
        <span className="text-sm text-muted-foreground">
          {t('settings.device', { name: deviceKey })}
        </span>
      </Row>
      <Row>
        <span className="text-sm">{t('settings.offset')}</span>
        <span className="font-mono text-sm tabular">
          {offset === 0
            ? t('settings.offsetNone')
            : t('settings.offsetValue', { sign: offset > 0 ? '+' : '−', n: Math.abs(offset) })}
        </span>
      </Row>
      <Row>
        <span className="text-sm">{t('settings.range')}</span>
        <span className="text-right font-mono text-sm tabular">
          {lo !== null && hi !== null
            ? t('settings.rangeValue', {
                low: noteName(lo),
                high: noteName(hi),
                keys: hi - lo + 1,
              })
            : t('settings.rangeNone')}
        </span>
      </Row>
      {lo !== null &&
        hi !== null &&
        profile &&
        profile.lowestNote !== null &&
        profile.highestNote !== null && (
          <Row>
            <span className={matches ? 'text-sm text-success' : 'text-sm text-warning'}>
              {matches
                ? t('settings.profileMatch', { name: profile.name })
                : t('settings.profileMismatch', {
                    name: profile.name,
                    low: noteName(profile.lowestNote),
                    high: noteName(profile.highestNote),
                  })}
            </span>
          </Row>
        )}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        {prompt ? (
          <>
            <p className="mr-auto animate-pulse text-sm font-medium text-primary" role="status">
              {prompt}
            </p>
            <Button size="sm" variant="ghost" onClick={() => calibration.cancel()}>
              {t('settings.cancel')}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => calibration.start('octave')}>
              <Music2 />
              {t('settings.calibrateC')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => calibration.start('range')}>
              <Ruler />
              {t('settings.measureRange')}
            </Button>
            {offset !== 0 && (
              <Button size="sm" variant="ghost" onClick={() => void calibration.resetOffset()}>
                <RotateCcw />
                {t('settings.resetOffset')}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <Row>
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        {hint && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </Row>
  );
}

function InputPanel() {
  const { t } = useTranslation();
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const base = useComputerKeyboard((s) => s.base);
  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-card">
      <SwitchRow
        label={t('settings.sustainCounts')}
        checked={settings.sustainCountsAsHeld}
        onChange={(v) => update({ sustainCountsAsHeld: v })}
      />
      <SwitchRow
        label={t('settings.computerKeyboard')}
        hint={t('settings.computerKeyboardHint', { base: noteName(base) })}
        checked={settings.computerKeyboard}
        onChange={(v) => update({ computerKeyboard: v })}
      />
      <Row>
        <div className="min-w-0 flex-1">
          <span className="text-sm">{t('settings.onscreenMode')}</span>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t('settings.latchHint')}
          </p>
        </div>
        <ToggleGroup
          type="single"
          size="sm"
          value={settings.onscreenMode}
          onValueChange={(v) => v && update({ onscreenMode: v as AppSettings['onscreenMode'] })}
          aria-label={t('settings.onscreenMode')}
          className="rounded-md border border-border p-0.5"
        >
          <ToggleGroupItem value="momentary" className="px-3">
            <Piano />
            {t('settings.momentary')}
          </ToggleGroupItem>
          <ToggleGroupItem value="latch" className="px-3">
            <KeyboardIcon />
            {t('settings.latch')}
          </ToggleGroupItem>
        </ToggleGroup>
      </Row>
      <SwitchRow
        label={t('settings.onscreenSound')}
        checked={settings.onscreenSound}
        onChange={(v) => update({ onscreenSound: v })}
      />
      <SwitchRow
        label={t('settings.feedbackSound')}
        checked={settings.feedbackSound}
        onChange={(v) => update({ feedbackSound: v })}
      />
    </div>
  );
}

function MsSlider({
  label,
  value,
  min,
  max,
  step,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div className="space-y-3 px-4 py-4">
      <div className="flex items-baseline justify-between gap-4">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        <span className="font-mono text-sm tabular">{t('settings.ms', { n: local })}</span>
      </div>
      <Slider
        id={id}
        aria-label={label}
        value={[local]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => v !== undefined && setLocal(v)}
        onValueCommit={([v]) => v !== undefined && onCommit(v)}
      />
    </div>
  );
}

function JudgePanel() {
  const { t } = useTranslation();
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const isDefault =
    settings.onsetWindowMs === DEFAULT_ATTEMPT_OPTIONS.onsetWindowMs &&
    settings.stableMs === DEFAULT_ATTEMPT_OPTIONS.stableMs;
  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-card">
      <MsSlider
        label={t('settings.window')}
        value={settings.onsetWindowMs}
        min={30}
        max={200}
        step={5}
        onCommit={(v) => update({ onsetWindowMs: v })}
      />
      <MsSlider
        label={t('settings.stable')}
        value={settings.stableMs}
        min={60}
        max={400}
        step={10}
        onCommit={(v) => update({ stableMs: v })}
      />
      {!isDefault && (
        <div className="px-4 py-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              update({
                onsetWindowMs: DEFAULT_ATTEMPT_OPTIONS.onsetWindowMs,
                stableMs: DEFAULT_ATTEMPT_OPTIONS.stableMs,
              })
            }
          >
            <RotateCcw />
            {t('settings.resetJudge')}
          </Button>
        </div>
      )}
    </div>
  );
}

function AboutPanel() {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm leading-relaxed">
      <p>{t('settings.about')}</p>
      <div>
        <p className="font-medium">{t('settings.credits')}</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            {t('settings.creditSalamander')}{' '}
            <a
              href="http://creativecommons.org/licenses/by/3.0/"
              className="underline underline-offset-2 hover:text-foreground"
              target="_blank"
              rel="noreferrer"
            >
              CC-BY 3.0
            </a>
          </li>
          <li>{t('settings.creditFonts')}</li>
        </ul>
      </div>
      <p>
        <Link
          to="/design"
          className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {t('settings.designLink')}
        </Link>
      </p>
    </div>
  );
}
