import { cn } from '@/lib/utils';

/** 品牌字标：三根琴键组成的小图形 + MayoChord。 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 22 18" className="h-[1.05em] w-auto" aria-hidden="true">
        <rect x="0" y="0" width="6" height="18" rx="1.4" fill="var(--foreground)" />
        <rect x="8" y="0" width="6" height="18" rx="1.4" fill="var(--primary)" />
        <rect x="16" y="0" width="6" height="18" rx="1.4" fill="var(--foreground)" />
        <rect x="4.5" y="0" width="4.5" height="10" rx="1" fill="var(--background)" />
        <rect x="13" y="0" width="4.5" height="10" rx="1" fill="var(--background)" />
      </svg>
      <span className="font-display-chord text-[1.05em] leading-none tracking-tight">
        Mayo<span className="text-primary">Chord</span>
      </span>
    </span>
  );
}
