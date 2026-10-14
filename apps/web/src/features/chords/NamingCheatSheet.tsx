import type { ChordSymbol } from '@mayochord/core';
import { useTranslation } from 'react-i18next';
import { ChordName } from '@/design/ChordName';

const ITEMS: { symbol: ChordSymbol; key: string }[] = [
  { symbol: { root: 0, quality: 'm' }, key: 'chords.namingM' },
  { symbol: { root: 0, quality: '7' }, key: 'chords.naming7' },
  { symbol: { root: 0, quality: 'M7' }, key: 'chords.namingM7' },
  { symbol: { root: 0, quality: 'm7b5' }, key: 'chords.namingM7b5' },
  { symbol: { root: 0, quality: '7(9)' }, key: 'chords.naming9' },
];

/** 和弦命名规则速查：m、7、M7、m7♭5、(9)。 */
export function NamingCheatSheet() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="naming-title" className="rounded-xl border border-border bg-card">
      <h2 id="naming-title" className="border-b border-border px-4 py-3 text-sm font-semibold">
        {t('chords.naming')}
      </h2>
      <dl className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-5 lg:divide-x">
        {ITEMS.map(({ symbol, key }) => (
          <div key={key} className="flex gap-4 p-4 sm:border-border lg:flex-col lg:gap-2">
            <dt className="w-16 shrink-0 lg:w-auto">
              <ChordName symbol={symbol} size="sm" className="text-2xl" />
            </dt>
            <dd className="text-sm leading-relaxed text-muted-foreground">
              {t(key as 'chords.namingM')}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
