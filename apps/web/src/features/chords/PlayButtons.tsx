import { AudioLines, Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getPiano, usePianoStatus } from '@/audio/piano';
import { Button } from '@/design/ui/button';

/** 用网页钢琴音色播放一组音：同时弹 / 分解弹。 */
export function PlayButtons({
  notes,
  compact = false,
}: {
  notes: readonly number[];
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const status = usePianoStatus((s) => s.status);

  const play = async (stagger: number) => {
    try {
      const piano = await getPiano();
      piano.playNotes(notes, { stagger, duration: stagger ? 2.4 : 1.8 });
    } catch {
      /* 状态已经显示在下面 */
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size={compact ? 'sm' : 'default'} onClick={() => void play(0)}>
        <Volume2 />
        {t('chords.playBlock')}
      </Button>
      <Button size={compact ? 'sm' : 'default'} variant="outline" onClick={() => void play(0.16)}>
        <AudioLines />
        {t('chords.playArpeggio')}
      </Button>
      <span className="text-sm text-muted-foreground" aria-live="polite">
        {status === 'loading' && t('chords.pianoLoading')}
        {status === 'error' && <span className="text-destructive">{t('chords.pianoError')}</span>}
      </span>
    </div>
  );
}
