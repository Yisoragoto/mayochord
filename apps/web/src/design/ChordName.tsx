import {
  type Accidental,
  type ChordSymbol,
  type ChordSymbolParts,
  chordSymbolParts,
  formatChordSymbol,
  type Spelling,
} from '@mayochord/core';
import { cn } from '@/lib/utils';

export interface ChordNameProps {
  symbol: ChordSymbol;
  spelling?: Spelling;
  /** stage：练习界面（谱架 1 米外可读）；lg：卡片标题；md：行内 */
  size?: 'stage' | 'lg' | 'md' | 'sm';
  className?: string;
}

const SIZE: Record<NonNullable<ChordNameProps['size']>, string> = {
  stage: 'text-[length:var(--text-chord-stage)]',
  lg: 'text-[length:var(--text-chord-lg)]',
  md: 'text-4xl',
  sm: 'text-xl',
};

/**
 * 和弦符号排版：♭ ♯ 使用音乐字体字形，扩展音（♭5、(9)、add9）用较小字号上移。
 * 例如 Cm7♭5、C7(9)、F♯m/E。
 */
export function ChordName({ symbol, spelling, size = 'md', className }: ChordNameProps) {
  const parts = chordSymbolParts(symbol, spelling);
  return (
    <span
      className={cn(
        'font-display-chord inline-flex items-baseline whitespace-nowrap',
        SIZE[size],
        className,
      )}
      aria-label={formatChordSymbol(symbol, spelling)}
      role="img"
    >
      <ChordParts parts={parts} />
    </span>
  );
}

export function ChordParts({ parts }: { parts: ChordSymbolParts }) {
  return (
    <>
      <span>{parts.rootLetter}</span>
      <Acc a={parts.rootAccidental} />
      {parts.main && <span className="ml-[0.02em]">{parts.main}</span>}
      {parts.ext && <Ext text={parts.ext} />}
      {parts.bass && (
        <>
          <span className="mx-[0.04em] font-normal opacity-55">/</span>
          <span>{parts.bass.letter}</span>
          <Acc a={parts.bass.accidental} />
        </>
      )}
    </>
  );
}

function Acc({ a }: { a: Accidental }) {
  if (!a) return null;
  return (
    <span className="relative -top-[0.32em] ml-[0.03em] font-[family-name:var(--font-music)] text-[0.62em] font-normal">
      {a}
    </span>
  );
}

/** 扩展部分：其中的 ♭ ♯ 同样使用音乐字体。 */
function Ext({ text }: { text: string }) {
  const segments = text.split(/([♭♯])/).filter(Boolean);
  return (
    <span className="relative -top-[0.62em] ml-[0.06em] text-[0.46em] tracking-normal">
      {segments.map((s, i) =>
        s === '♭' || s === '♯' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: 静态分段，顺序不会变化
          <span key={i} className="font-[family-name:var(--font-music)] font-normal">
            {s}
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: 同上
          <span key={i}>{s}</span>
        ),
      )}
    </span>
  );
}
