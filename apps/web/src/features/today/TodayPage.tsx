import { Link } from '@tanstack/react-router';
import { ArrowRight, Dumbbell, Library } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Keyboard, type KeyMark } from '@/design/keyboard/Keyboard';
import { Button } from '@/design/ui/button';

// 空状态插图：Am7 的参考键位（左手 A3，右手 G4 C5 E5）
const DEMO_MARKS = new Map<number, KeyMark>([
  [57, { kind: 'target', hand: 'left', finger: 5 }],
  [67, { kind: 'target', hand: 'right', finger: 1 }],
  [72, { kind: 'target', hand: 'right', finger: 3 }],
  [76, { kind: 'target', hand: 'right', finger: 5 }],
]);

export function TodayPage() {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="today-title"
      className="grid gap-10 pt-6 md:grid-cols-[1.1fr_1fr] md:items-center md:pt-16"
    >
      <div className="max-w-xl">
        <p className="mb-3 font-mono text-xs tracking-[0.2em] text-primary uppercase">
          {new Intl.DateTimeFormat('zh-CN', {
            month: 'long',
            day: 'numeric',
            weekday: 'long',
          }).format(new Date())}
        </p>
        <h1
          id="today-title"
          className="font-cjk-heading text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          {t('today.emptyTitle')}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          {t('today.emptyBody')}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/practice">
              <Dumbbell />
              {t('today.startPractice')}
              <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/chords">
              <Library />
              {t('today.openChords')}
            </Link>
          </Button>
        </div>
      </div>
      <div aria-hidden className="relative">
        <div className="absolute -inset-8 rounded-full bg-[radial-gradient(closest-side,var(--glow),transparent)]" />
        <Keyboard low={53} high={79} marks={DEMO_MARKS} labels="c" className="relative" />
      </div>
    </section>
  );
}
