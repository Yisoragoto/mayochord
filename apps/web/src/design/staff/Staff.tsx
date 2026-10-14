import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export interface StaffProps {
  lh: readonly string[];
  rh: readonly string[];
  /** 屏幕阅读器读出的说明，例如“五线谱：左手 A3，右手 G4 C5 E5” */
  label: string;
  className?: string;
}

/** 大谱表。VexFlow 体积较大，只在第一次显示五线谱时加载。 */
export function Staff({ lh, rh, label, className }: StaffProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const lhKey = lh.join(' ');
  const rhKey = rh.join(' ');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    import('./render-staff')
      .then(({ renderGrandStaff }) => {
        if (cancelled || !ref.current) return;
        renderGrandStaff(ref.current, {
          lh: lhKey ? lhKey.split(' ') : [],
          rh: rhKey ? rhKey.split(' ') : [],
        });
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [lhKey, rhKey]);

  return (
    <div className={cn('relative aspect-[210/222]', className)} role="img" aria-label={label}>
      <div ref={ref} className="mc-staff text-foreground [&_svg]:h-auto [&_svg]:w-full" />
      {state !== 'ready' && (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          {state === 'loading' ? (
            <div className="h-full w-full animate-pulse rounded-md bg-surface-2/60" />
          ) : (
            t('chords.staffError')
          )}
        </div>
      )}
    </div>
  );
}
