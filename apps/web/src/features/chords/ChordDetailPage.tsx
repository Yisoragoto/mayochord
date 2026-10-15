import { BUILTIN_PACK, type ChordEntry } from '@mayochord/content';
import {
  describeRightHand,
  formatChordSymbol,
  handMidi,
  prettyAccidentals,
  romanNumeral,
  voicingMidi,
} from '@mayochord/core';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ChordName } from '@/design/ChordName';
import { Keyboard } from '@/design/keyboard/Keyboard';
import { Staff } from '@/design/staff/Staff';
import { Badge } from '@/design/ui/badge';
import { localize } from '@/lib/localize';
import { useDocumentTitle } from '@/lib/use-document-title';
import { cn } from '@/lib/utils';
import { Formula, Tones } from './Formula';
import { PlayButtons } from './PlayButtons';
import { TrialPanel } from './TrialPanel';
import { keyboardRange, referenceMarks } from './voicing-view';

export function ChordDetailPage({ chordId }: { chordId: string }) {
  const { t } = useTranslation();
  const chord = BUILTIN_PACK.chordById.get(chordId);
  useDocumentTitle(chord ? formatChordSymbol(chord.symbol) : t('chords.notFound'));

  if (!chord) {
    return (
      <div className="space-y-4 pt-10">
        <BackLink />
        <p className="text-muted-foreground">{t('chords.notFound')}</p>
      </div>
    );
  }
  return <ChordDetail chord={chord} />;
}

function BackLink() {
  const { t } = useTranslation();
  return (
    <Link
      to="/chords"
      className="inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {t('chords.back')}
    </Link>
  );
}

function ChordDetail({ chord }: { chord: ChordEntry }) {
  const { t } = useTranslation();
  const ref = chord.reference;
  const all = voicingMidi(ref);
  const range = keyboardRange(all, 5);
  const lh = ref.notes.filter((n) => n.hand === 'left');
  const rh = ref.notes.filter((n) => n.hand === 'right');
  const shape = describeRightHand(handMidi(ref, 'right'), chord.rootName, chord.quality);
  const shapeText =
    shape.inversion === 'root'
      ? t('chords.shapeRoot')
      : shape.inversion === 'first'
        ? t('chords.shapeFirst')
        : shape.inversion === 'second'
          ? t('chords.shapeSecond')
          : shape.inversion === 'third'
            ? t('chords.shapeThird')
            : shape.lowestDegree !== null
              ? t('chords.shapeLowest', { degree: shape.lowestDegree })
              : null;
  const note = BUILTIN_PACK.voicingNotes.get(ref.id);
  const progressions = BUILTIN_PACK.progressions.filter((p) =>
    p.steps.some((s) => s.chord.id === chord.id),
  );
  const fmt = (n: { name: string; finger?: number }) =>
    `${prettyAccidentals(n.name)}${n.finger !== undefined ? `（${n.finger}）` : ''}`;

  return (
    <div className="space-y-8">
      <BackLink />

      <section className="grid gap-8 md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)] md:items-start">
        <div className="space-y-5">
          <div className="flex flex-wrap items-end gap-4">
            <h1>
              <ChordName symbol={chord.symbol} size="lg" className="text-[clamp(4rem,12vw,7rem)]" />
            </h1>
            {ref.status === 'tentative' && (
              <Badge variant="outline" className="mb-3 border-warning/60 text-warning">
                {t('chords.tentative')}
              </Badge>
            )}
            {ref.status === 'generated' && (
              <Badge variant="outline" className="mb-3 text-muted-foreground">
                {t('chords.generated')}
              </Badge>
            )}
          </div>

          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">{t('chords.tones')}</dt>
            <dd className="text-base">
              <Tones chord={chord} />
            </dd>
            <dt className="text-muted-foreground">{t('chords.formula')}</dt>
            <dd>
              <Formula chord={chord} />
            </dd>
            <dt className="text-muted-foreground">{t('chords.voicing')}</dt>
            <dd className="space-y-1 tabular">
              <p>
                <span className="mr-2 inline-block size-2.5 rounded-full bg-hand-left align-middle" />
                {t('chords.leftHand')} {lh.map(fmt).join(' ')}
                <span className="mx-3 text-subtle-foreground">·</span>
                <span className="mr-2 inline-block size-2.5 rounded-full bg-hand-right align-middle" />
                {t('chords.rightHand')} {rh.map(fmt).join(' ')}
              </p>
              {shapeText && <p className="text-muted-foreground">{shapeText}</p>}
            </dd>
          </dl>

          {note && (
            <p className="flex gap-2 rounded-lg border-l-4 border-warning bg-warning/5 px-4 py-3 text-sm leading-relaxed">
              <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              {localize(note)}
            </p>
          )}

          <PlayButtons notes={all} />
        </div>

        <figure className="rounded-xl border border-border bg-card p-4">
          <figcaption className="mb-2 text-xs text-muted-foreground">
            {t('chords.staff')}
          </figcaption>
          <Staff
            lh={lh.map((n) => n.name)}
            rh={rh.map((n) => n.name)}
            label={t('chords.staffLabel', {
              lh: lh.map((n) => prettyAccidentals(n.name)).join(' '),
              rh: rh.map((n) => prettyAccidentals(n.name)).join(' '),
            })}
            className="mx-auto max-w-56"
          />
        </figure>
      </section>

      <div className="mx-auto max-w-3xl overflow-x-auto rounded-xl border border-border bg-card p-3 sm:p-4">
        <Keyboard
          low={range.low}
          high={range.high}
          marks={referenceMarks(ref)}
          labels="c"
          aria-label={`${formatChordSymbol(chord.symbol)} ${t('chords.voicing')}`}
        />
      </div>

      <TrialPanel chord={chord} />

      {progressions.length > 0 && (
        <section aria-labelledby="prog-title" className="space-y-3">
          <h2 id="prog-title" className="text-lg font-semibold">
            {t('chords.inProgressions')}
          </h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {progressions.map((p) => (
              <li key={p.id} className="rounded-xl border border-border bg-card p-4">
                <p className="mb-3 text-sm font-medium">{localize(p.name)}</p>
                <ol className="flex flex-wrap gap-2">
                  {p.steps.map((s, i) => (
                    <li
                      // biome-ignore lint/suspicious/noArrayIndexKey: 进行里同一个和弦可能出现多次，顺序固定
                      key={i}
                      className={cn(
                        'flex min-w-14 flex-col items-center rounded-md border px-2.5 py-1.5',
                        s.chord.id === chord.id
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-surface-2',
                      )}
                    >
                      <Link
                        to="/chords/$chordId"
                        params={{ chordId: s.chord.id }}
                        className="rounded-sm"
                      >
                        <ChordName symbol={s.chord.symbol} size="sm" className="text-lg" />
                      </Link>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {romanNumeral(s.chord.rootName, s.chord.quality, { tonic: p.key })}
                      </span>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
