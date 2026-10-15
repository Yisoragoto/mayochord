import type { ChordEntry } from '@mayochord/content';
import { prettyAccidentals, semitoneFormula } from '@mayochord/core';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { listSep } from '@/lib/localize';

/** 半音距离公式，例如 A +3 C +4 E。 */
export function Formula({ chord }: { chord: ChordEntry }) {
  const { t } = useTranslation();
  const { tones, steps } = semitoneFormula(chord.rootName, chord.quality);
  const pretty = tones.map(prettyAccidentals);
  return (
    <p className="font-mono text-sm tabular">
      <span className="sr-only">
        {t('chords.formulaLabel', { tones: pretty.join(' '), steps: steps.join(listSep()) })}
      </span>
      <span aria-hidden className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {pretty.map((tone, i) => (
          <Fragment key={tone}>
            {i > 0 && (
              <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-xs text-primary">
                +{steps[i - 1]}
              </span>
            )}
            <span className="font-semibold text-foreground">{tone}</span>
          </Fragment>
        ))}
      </span>
    </p>
  );
}

/** 组成音，例如 G · B♭ · D · F */
export function Tones({ chord }: { chord: ChordEntry }) {
  return <span className="tabular">{chord.tones.map(prettyAccidentals).join(' · ')}</span>;
}
