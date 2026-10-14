import { BUILTIN_PACK, type ChordEntry } from '@mayochord/content';
import { formatChordSymbol } from '@mayochord/core';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ChordName } from '@/design/ChordName';
import { Keyboard } from '@/design/keyboard/Keyboard';
import { Badge } from '@/design/ui/badge';
import { useDocumentTitle } from '@/lib/use-document-title';
import { Tones } from './Formula';
import { NamingCheatSheet } from './NamingCheatSheet';
import { referenceMarks, sharedRange } from './voicing-view';

interface Group {
  id: string;
  title: string;
  hint?: string;
  chords: ChordEntry[];
}

export function ChordLibraryPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('chords.title'));
  const chords = BUILTIN_PACK.chords;
  const tentative = chords.filter((c) => c.reference.status === 'tentative');
  const confirmed = chords.filter((c) => c.reference.status === 'confirmed');
  const generated = chords.filter((c) => c.reference.status === 'generated');
  const groups: Group[] = [
    {
      id: 'triads',
      title: t('chords.groupTriads'),
      chords: confirmed.filter((c) => c.tones.length === 3),
    },
    {
      id: 'sevenths',
      title: t('chords.groupSevenths'),
      chords: confirmed.filter((c) => c.tones.length > 3),
    },
    {
      id: 'generated-triads',
      title: t('chords.groupGeneratedTriads'),
      hint: t('chords.groupGeneratedHint'),
      chords: generated.filter((c) => c.tones.length === 3 && c.bassName === undefined),
    },
    {
      id: 'generated-sevenths',
      title: t('chords.groupGeneratedSevenths'),
      hint: t('chords.groupGeneratedHint'),
      chords: generated.filter((c) => c.tones.length > 3 && c.bassName === undefined),
    },
    {
      id: 'slash',
      title: t('chords.groupSlash'),
      hint: t('chords.groupSlashHint'),
      chords: generated.filter((c) => c.bassName !== undefined),
    },
    {
      id: 'tentative',
      title: t('chords.groupTentative'),
      hint: t('chords.groupTentativeHint'),
      chords: tentative,
    },
  ];

  return (
    <div className="space-y-10">
      <header>
        <h1 className="font-cjk-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('chords.title')}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('chords.subtitle')}</p>
      </header>

      <NamingCheatSheet />

      {groups
        .filter((g) => g.chords.length > 0)
        .map((g) => (
          <section key={g.id} aria-labelledby={`group-${g.id}`} className="space-y-4">
            <div>
              <h2 id={`group-${g.id}`} className="flex items-baseline gap-3 text-lg font-semibold">
                {g.title}
                <span className="font-mono text-xs font-normal text-subtle-foreground tabular">
                  {g.chords.length}
                </span>
              </h2>
              {g.hint && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{g.hint}</p>}
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.chords.map((c) => (
                <li key={c.id}>
                  <ChordCard chord={c} range={sharedRange(g.chords.map((x) => x.reference))} />
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

function ChordCard({ chord, range }: { chord: ChordEntry; range: { low: number; high: number } }) {
  const { t } = useTranslation();
  const name = formatChordSymbol(chord.symbol);
  return (
    <article className="group relative flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors duration-[var(--dur-fast)] hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <h3>
          <Link
            to="/chords/$chordId"
            params={{ chordId: chord.id }}
            aria-label={t('chords.open', { name })}
            className="rounded-sm after:absolute after:inset-0 after:rounded-xl"
          >
            <ChordName symbol={chord.symbol} size="md" className="text-5xl" />
          </Link>
        </h3>
        {chord.reference.status === 'tentative' && (
          <Badge variant="outline" className="border-warning/60 text-warning">
            {t('chords.tentative')}
          </Badge>
        )}
        {chord.reference.status === 'generated' && (
          <Badge variant="outline" className="text-muted-foreground">
            {t('chords.generated')}
          </Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        <Tones chord={chord} />
      </p>
      <Keyboard
        low={range.low}
        high={range.high}
        marks={referenceMarks(chord.reference)}
        labels="c"
        aria-label={`${name} ${t('chords.voicing')}`}
        className="mt-auto transition-transform duration-[var(--dur-base)] group-hover:-translate-y-0.5"
      />
    </article>
  );
}
