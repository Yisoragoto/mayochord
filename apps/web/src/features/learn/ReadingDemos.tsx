import { BUILTIN_PACK, type ExplainStep } from '@mayochord/content';
import { prettyAccidentals } from '@mayochord/core';
import { Play, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { playRhythm, type RhythmPlayback } from '@/audio/rhythm-play';
import { RhythmStaff, StaffLine } from '@/design/staff/StaffLine';
import { Button } from '@/design/ui/button';
import { useSettings } from '@/stores/settings';

/** 读谱课程讲解里的谱表示范（M10） */
export function StaffDemo({ staff }: { staff: NonNullable<ExplainStep['staff']> }) {
  const { t } = useTranslation();
  const label =
    staff.notes.length > 0
      ? t('learn.staffDemoLabel', { notes: staff.notes.map(prettyAccidentals).join(' ') })
      : t('learn.staffDemoEmpty');
  return (
    <StaffLine
      clef={staff.clef}
      musicKey={staff.key ?? null}
      notes={staff.notes}
      labels={staff.labels}
      label={label}
      className={staff.clef === 'grand' ? 'w-full max-w-sm' : 'w-full max-w-lg'}
    />
  );
}

/** 节奏示范：谱 + 播放（预备一小节后，节拍器和每个音的起点一起响） */
export function RhythmDemo({ rhythmId }: { rhythmId: string }) {
  const { t } = useTranslation();
  const rhythm = BUILTIN_PACK.rhythmById.get(rhythmId);
  const [playing, setPlaying] = useState(false);
  const [beat, setBeat] = useState<number | null>(null);
  const handle = useRef<RhythmPlayback | null>(null);
  useEffect(() => () => handle.current?.stop(), []);
  if (!rhythm) return null;

  const play = async () => {
    handle.current?.stop();
    setPlaying(true);
    try {
      const volume = useSettings.getState().settings.metronomeVolume;
      const h = await playRhythm(rhythm.pattern, rhythm.time, rhythm.bpm, {
        demo: true,
        volume,
        onBeat: (b) => setBeat(b),
      });
      handle.current = h;
      const end =
        h.metronome.grid.startT +
        (rhythm.pattern.length / 960) * h.metronome.grid.beatMs -
        performance.now();
      setTimeout(
        () => {
          setPlaying(false);
          setBeat(null);
        },
        Math.max(0, end + 300),
      );
    } catch {
      setPlaying(false);
    }
  };
  const stop = () => {
    handle.current?.stop();
    setPlaying(false);
    setBeat(null);
  };

  return (
    <div className="space-y-3">
      <RhythmStaff
        tokens={rhythm.pattern.tokens}
        time={rhythm.time}
        label={t('learn.rhythmDemoLabel', { notes: rhythm.notes })}
        className="w-full max-w-lg"
      />
      <div className="flex items-center gap-3">
        {playing ? (
          <Button size="sm" variant="outline" onClick={stop}>
            <Square />
            {t('learn.stopDemo')}
          </Button>
        ) : (
          <Button size="sm" onClick={() => void play()} data-testid="rhythm-demo-play">
            <Play />
            {t('learn.playRhythm', { bpm: rhythm.bpm })}
          </Button>
        )}
        {playing && beat !== null && (
          <span className="font-mono text-sm text-muted-foreground tabular-nums">
            {beat < 0 ? t('learn.countIn', { n: -beat }) : t('learn.beatN', { n: beat + 1 })}
          </span>
        )}
      </div>
    </div>
  );
}
