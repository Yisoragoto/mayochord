import { BUILTIN_PACK } from '@mayochord/content';
import {
  type CardProgress,
  type DrillType,
  formatChordSymbol,
  prettyAccidentals,
  type VoicingMode,
} from '@mayochord/core';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Info } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChordName } from '@/design/ChordName';
import { Button } from '@/design/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/design/ui/toggle-group';
import { MidiConnectButton } from '@/features/midi/MidiDevicePanel';
import { localize } from '@/lib/localize';
import { useDocumentTitle } from '@/lib/use-document-title';
import { cn } from '@/lib/utils';
import { tryRepositories } from '@/storage';
import { phaseCounts } from './controller';
import { cardsForGroup, type PracticeGroup } from './groups';
import { PracticeTabs } from './PracticeTabs';
import { PRACTICE_GROUPS } from './practice';
import type { PracticeSearch } from './search';

const LENGTHS = [10, 20, 30] as const;

/** 和弦序列：C – G – Am – F */
export function ChordSequence({ chordIds }: { chordIds: readonly string[] }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
      {chordIds.map((id, i) => {
        const chord = BUILTIN_PACK.chordById.get(id);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: 进行里同一个和弦可能出现多次
          <span key={`${id}-${i}`} className="inline-flex items-baseline gap-1.5">
            {i > 0 && <span className="text-subtle-foreground">–</span>}
            {chord && <ChordName symbol={chord.symbol} size="sm" />}
          </span>
        );
      })}
    </span>
  );
}

/** 组名就是和弦序列本身（例如“C – G – Am – F”）时不重复显示 */
function nameIsSequence(g: PracticeGroup): boolean {
  if (!g.name || !g.sequence) return false;
  const strip = (x: string) => prettyAccidentals(x).replace(/[\s–-]/g, '');
  const seq = g.chordIds
    .map((id) => {
      const chord = BUILTIN_PACK.chordById.get(id);
      return chord ? formatChordSymbol(chord.symbol) : id;
    })
    .join('');
  return strip(g.name['zh-CN']) === strip(seq);
}

function useGroupProgress(drill: DrillType, mode: VoicingMode) {
  const [progress, setProgress] = useState<Map<string, CardProgress> | null>(null);
  useEffect(() => {
    let alive = true;
    const repos = tryRepositories();
    const ids = PRACTICE_GROUPS.flatMap((g) => cardsForGroup(g, drill, mode).map((c) => c.id));
    (repos ? repos.cardStates.getMany(ids) : Promise.resolve(new Map<string, CardProgress>()))
      .then((p) => alive && setProgress(p))
      .catch(() => alive && setProgress(new Map()));
    return () => {
      alive = false;
    };
  }, [drill, mode]);
  return progress;
}

export function PracticeSetupPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('practice.title'));
  const [groupId, setGroupId] = useState(PRACTICE_GROUPS[0]?.id ?? 'all');
  const [drill, setDrill] = useState<PracticeSearch['drill']>('name-to-chord');
  const [mode, setMode] = useState<VoicingMode>('any');
  const [length, setLength] = useState<number>(20);
  const progress = useGroupProgress(drill, mode);
  const now = useMemo(() => Date.now(), []);

  const group = PRACTICE_GROUPS.find((g) => g.id === groupId);
  // 切换、听和弦都要一条进行（"全部和弦"没有顺序，听和弦的选项也太多）
  const transitionUnavailable = drill !== 'name-to-chord' && group && !group.sequence;
  const groupName = (g: PracticeGroup) => (g.name ? localize(g.name) : t('practice.allChords'));

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <PracticeTabs current="chords" />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-cjk-heading text-2xl font-semibold tracking-tight sm:text-3xl">
              {t('practice.title')}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('practice.subtitle')}</p>
          </div>
          <MidiConnectButton />
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm font-medium text-muted-foreground">
            {t('practice.group')}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {PRACTICE_GROUPS.map((g) => {
              const cards = cardsForGroup(g, drill, mode);
              const counts = progress ? phaseCounts(cards, progress, now) : null;
              const selected = g.id === groupId;
              const disabled = drill !== 'name-to-chord' && !g.sequence;
              return (
                <label
                  key={g.id}
                  className={cn(
                    'flex cursor-pointer flex-col gap-2 rounded-xl border bg-card p-4 transition-colors duration-[var(--dur-fast)]',
                    'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
                    selected
                      ? 'border-primary bg-primary/8 shadow-[inset_0_0_0_1px_var(--primary)]'
                      : 'border-border hover:border-border-strong',
                    disabled && 'cursor-not-allowed opacity-45',
                  )}
                >
                  <input
                    type="radio"
                    name="practice-group"
                    value={g.id}
                    checked={selected}
                    disabled={disabled}
                    onChange={() => setGroupId(g.id)}
                    aria-label={groupName(g)}
                    className="sr-only"
                  />
                  {!nameIsSequence(g) && <span className="font-medium">{groupName(g)}</span>}
                  {g.sequence ? (
                    <ChordSequence chordIds={g.chordIds} />
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {t('practice.cards', { n: g.chordIds.length })}
                    </span>
                  )}
                  {counts && counts.total > 0 && (
                    <span className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground tabular-nums">
                      <span>{t('practice.countNew', { n: counts.fresh })}</span>
                      <span>{t('practice.countLearning', { n: counts.learning })}</span>
                      <span>{t('practice.countMixed', { n: counts.mixed })}</span>
                      {counts.due > 0 && (
                        <span className="text-primary">
                          {t('practice.countDue', { n: counts.due })}
                        </span>
                      )}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="space-y-6">
          <Option label={t('practice.drill')}>
            <ToggleGroup
              type="single"
              value={drill}
              onValueChange={(v) => v && setDrill(v as PracticeSearch['drill'])}
              aria-label={t('practice.drill')}
              className="w-full rounded-md border border-border p-0.5"
            >
              <ToggleGroupItem value="name-to-chord" className="flex-1">
                {t('practice.drillName')}
              </ToggleGroupItem>
              <ToggleGroupItem value="transition" className="flex-1">
                {t('practice.drillTransition')}
              </ToggleGroupItem>
              <ToggleGroupItem value="ear-to-chord" className="flex-1">
                {t('practice.drillEar')}
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="text-sm text-muted-foreground">
              {drill === 'transition'
                ? t('practice.drillTransitionHint')
                : drill === 'ear-to-chord'
                  ? t('practice.drillEarHint')
                  : t('practice.drillNameHint')}
            </p>
          </Option>

          <Option label={t('practice.mode')}>
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(v) => v && setMode(v as VoicingMode)}
              aria-label={t('practice.mode')}
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

          <Option label={t('practice.length')}>
            <ToggleGroup
              type="single"
              value={String(length)}
              onValueChange={(v) => v && setLength(Number(v))}
              aria-label={t('practice.length')}
              className="w-full rounded-md border border-border p-0.5"
            >
              {LENGTHS.map((n) => (
                <ToggleGroupItem key={n} value={String(n)} className="flex-1 tabular-nums">
                  {t('practice.lengthN', { n })}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Option>

          {transitionUnavailable && (
            <p className="text-sm text-warning">{t('practice.transitionNeedsSequence')}</p>
          )}

          <Button
            asChild={!transitionUnavailable}
            size="lg"
            className="w-full"
            disabled={transitionUnavailable}
          >
            {transitionUnavailable ? (
              <span>{t('practice.start')}</span>
            ) : (
              <Link to="/practice/session" search={{ groupId, drill, mode, length }}>
                {t('practice.start')}
                <ArrowRight />
              </Link>
            )}
          </Button>

          <div className="flex gap-2 rounded-lg border border-border bg-surface-2/50 p-3 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="space-y-2">
              <p>{t('practice.howItWorks')}</p>
              <p>{t('practice.inputHint')}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Option({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
