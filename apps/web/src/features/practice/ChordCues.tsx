import type { ChordEntry } from '@mayochord/content';
import { type ChordCard, prettyAccidentals, romanNumeral } from '@mayochord/core';
import { Ear, RotateCcw, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChordName } from '@/design/ChordName';
import { Staff } from '@/design/staff/Staff';
import { Button } from '@/design/ui/button';
import { cn } from '@/lib/utils';
import { chordLabel, chordOf } from './cards-view';
import type { PracticeView } from './controller';
import { practice } from './practice';

/** 和弦在调里的级数（日本流行乐写法：VIm、V7、IVM7） */
export const romanOf = (chord: ChordEntry, key: string) =>
  romanNumeral(chord.rootName, chord.quality, { tonic: key });

/** 文字名称："E♭ 小三和弦"（12 调构建） */
export function useSpelledName() {
  const { t } = useTranslation();
  return (chord: ChordEntry) =>
    `${prettyAccidentals(chord.rootName)} ${t(`practice.qualityWords.${chord.quality}`)}`;
}

/** 大谱表上的和弦（按参考键位的左右手） */
export function ChordStaff({ chord, className }: { chord: ChordEntry; className?: string }) {
  const { t } = useTranslation();
  const lh = chord.reference.notes.filter((n) => n.hand === 'left').map((n) => n.name);
  const rh = chord.reference.notes.filter((n) => n.hand === 'right').map((n) => n.name);
  return (
    <Staff
      lh={lh}
      rh={rh}
      label={t('practice.staffLabel', {
        lh: lh.map(prettyAccidentals).join(' '),
        rh: rh.map(prettyAccidentals).join(' '),
      })}
      {...(className ? { className } : {})}
    />
  );
}

/**
 * 和弦卡的题面（规格 6.3 的 cue）：和弦名 / 文字名称 / 级数 / 五线谱 / 听声音。
 * revealed：判定之后（听辨题这时才显示答案）。
 */
export function ChordCueFace({
  card,
  size,
  listening,
  revealed,
}: {
  card: ChordCard;
  size: 'stage' | 'lg';
  listening: boolean;
  revealed: boolean;
}) {
  const { t } = useTranslation();
  const spelled = useSpelledName();
  const chord = chordOf(card.chordId);
  if (!chord) return null;
  switch (card.cue) {
    case 'name':
      return <ChordName symbol={chord.symbol} size={size} />;
    case 'spelled':
      return (
        <span className="flex flex-col items-center gap-3">
          <span className="font-cjk-heading text-[length:var(--text-chord-lg)] leading-none font-semibold">
            {spelled(chord)}
          </span>
          <span className="text-sm text-muted-foreground">{t('practice.spelledCaption')}</span>
        </span>
      );
    case 'roman':
      return (
        <span className="flex flex-col items-center gap-3">
          <span className="font-display-chord text-[length:var(--text-chord-stage)] leading-none">
            {romanOf(chord, card.key ?? 'C')}
          </span>
          <span className="text-sm text-muted-foreground">
            {t('practice.romanCaption', { key: prettyAccidentals(card.key ?? 'C') })}
          </span>
        </span>
      );
    case 'staff':
      return (
        <span className="flex flex-col items-center gap-2">
          <ChordStaff chord={chord} className="w-[min(30rem,85vw)]" />
          <span className="text-sm text-muted-foreground">{t('practice.staffCaption')}</span>
        </span>
      );
    case 'audio':
      return (
        <span className="flex flex-col items-center gap-3">
          {revealed ? (
            <span className="flex items-baseline gap-4">
              <ChordName symbol={chord.symbol} size={size} />
              {card.key && (
                <span className="font-display-chord text-[length:var(--text-chord-lg)] leading-none text-muted-foreground">
                  {romanOf(chord, card.key)}
                </span>
              )}
            </span>
          ) : (
            <Ear
              className={cn('size-24 text-primary sm:size-32', listening && 'animate-pulse')}
              aria-hidden
            />
          )}
          <span className="text-sm text-muted-foreground" role="status">
            {listening
              ? t('practice.listening')
              : card.key
                ? t('practice.earCaptionKey', { key: prettyAccidentals(card.key) })
                : t('practice.earCaption')}
          </span>
        </span>
      );
  }
}

/** 听声音的题：重听、点选答案；答完标出正确答案（对比配对时说明差在哪个音） */
export function ListeningControls({ view }: { view: PracticeView }) {
  const { t } = useTranslation();
  const trial = view.trial;
  const card = trial?.trial.card;
  const [picked, setPicked] = useState<string | null>(null);
  const trialId = trial?.trial.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 换题时清掉上一题的选择
  useEffect(() => setPicked(null), [trialId]);
  if (!trial || card?.kind !== 'chord' || card.cue !== 'audio') return null;
  const judged = trial.status === 'retry' || trial.status === 'done';
  const choices = view.choices ?? [];
  const label = (id: string) => {
    const c = chordOf(id);
    if (!c) return id;
    return card.key ? romanOf(c, card.key) : chordLabel(c);
  };
  const pair = choices.length === 2 ? choices.map((id) => chordOf(id)) : null;
  const diff =
    pair?.[0] && pair[1]
      ? {
          a: pair[0].tones.filter((x) => !pair[1]?.tones.includes(x)),
          b: pair[1].tones.filter((x) => !pair[0]?.tones.includes(x)),
        }
      : null;

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-4">
      {choices.length > 0 && (
        <fieldset className="flex flex-wrap justify-center gap-2">
          <legend className="sr-only">{t('practice.choicesLabel')}</legend>
          {choices.map((id) => {
            const correct = judged && id === card.chordId;
            const wrong = judged && picked === id && id !== card.chordId;
            return (
              <Button
                key={id}
                size="lg"
                variant="outline"
                disabled={view.listening || trial.status === 'done'}
                onClick={() => {
                  setPicked(id);
                  practice.answer(id);
                }}
                className={cn(
                  'min-w-16 font-display-chord text-lg',
                  correct && 'border-mark-correct bg-mark-correct/15 text-mark-correct',
                  wrong && 'border-mark-extra bg-mark-extra/10 text-mark-extra',
                )}
                data-choice={id}
              >
                {label(id)}
              </Button>
            );
          })}
        </fieldset>
      )}
      {judged && diff && diff.a.length > 0 && pair?.[0] && pair[1] && (
        <p className="text-sm text-muted-foreground">
          {t('practice.pairDiff', {
            a: chordLabel(pair[0]),
            b: chordLabel(pair[1]),
            x: diff.a.map(prettyAccidentals).join(' '),
            y: diff.b.map(prettyAccidentals).join(' '),
          })}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={view.listening}
          onClick={() => practice.replay(false)}
        >
          <Volume2 />
          {t('practice.replay')}
        </Button>
        {card.key && (
          <Button
            size="sm"
            variant="ghost"
            disabled={view.listening}
            onClick={() => practice.replay(true)}
          >
            <RotateCcw />
            {t('practice.replayWithKey')}
          </Button>
        )}
      </div>
    </div>
  );
}
