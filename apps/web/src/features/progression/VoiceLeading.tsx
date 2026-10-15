import { type VoicedNote, voiceLeading } from '@mayochord/core';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { keyboardLayout, keyCenterX } from '@/design/keyboard/Keyboard';
import { clauseSep } from '@/lib/localize';
import { cn } from '@/lib/utils';

export interface VoiceLeadingProps {
  from: readonly VoicedNote[];
  to: readonly VoicedNote[];
  /** 与下方键盘相同的音域，连线才能与琴键对齐 */
  low: number;
  high: number;
  className?: string;
}

const HEIGHT = 64;
const TOP = 12;
const BOTTOM = 52;

/**
 * 声部进行（规格 9）：上排是当前和弦，下排是下一个和弦，同一个声部用线连起来。
 * 共同音（保持不动）画竖直的虚线；移动的声部按距离着色并标出半音数（半音、全音最常见）。
 * 左右手分开配对（左手根音不和右手的音连）。
 */
export function VoiceLeading({ from, to, low, high, className }: VoiceLeadingProps) {
  const { t } = useTranslation();
  const { width } = useMemo(() => keyboardLayout(low, high), [low, high]);
  const moves = useMemo(() => {
    const hands = ['left', 'right'] as const;
    return hands.flatMap((hand) => {
      const a = from.filter((n) => n.hand === hand).map((n) => n.midi);
      const b = to.filter((n) => n.hand === hand).map((n) => n.midi);
      return voiceLeading(a, b).moves.map((m) => ({ ...m, hand }));
    });
  }, [from, to]);
  const x = (n: number) => keyCenterX(low, high, n);
  const label = moves
    .filter((m) => m.semitones !== null)
    .map((m) =>
      m.semitones === 0
        ? t('progression.vlKeep')
        : t('progression.vlMove', {
            n: (m.semitones as number) > 0 ? `+${m.semitones}` : String(m.semitones),
          }),
    )
    .join(clauseSep());

  return (
    <svg
      viewBox={`0 0 ${width} ${HEIGHT}`}
      className={cn('block h-auto w-full overflow-visible', className)}
      role="img"
      aria-label={`${t('progression.voiceLeading')}：${label}`}
    >
      {moves.map((m, i) => {
        const x1 = m.from === null ? null : x(m.from);
        const x2 = m.to === null ? null : x(m.to);
        const handColor = m.hand === 'left' ? 'var(--hand-left)' : 'var(--hand-right)';
        const key = `${m.hand}-${m.from}-${m.to}-${i}`;
        if (x1 === null || x2 === null) {
          // 新增或消失的声部：只画一端
          const cx = x1 ?? x2;
          if (cx === null) return null;
          return (
            <circle
              key={key}
              cx={cx}
              cy={x1 !== null ? TOP : BOTTOM}
              r={4}
              fill="none"
              stroke={handColor}
              strokeDasharray="2 2"
              strokeWidth={1.5}
            />
          );
        }
        const st = m.semitones ?? 0;
        const keep = st === 0;
        const step = Math.abs(st) <= 2;
        const midY = (TOP + BOTTOM) / 2;
        return (
          <g key={key} data-move={st}>
            <line
              x1={x1}
              y1={TOP}
              x2={x2}
              y2={BOTTOM}
              stroke={keep ? 'var(--subtle-foreground)' : handColor}
              strokeWidth={keep ? 1.5 : step ? 2.2 : 1.6}
              strokeDasharray={keep ? '3 3' : step ? undefined : '6 3'}
              strokeLinecap="round"
            />
            <circle cx={x1} cy={TOP} r={4} fill={handColor} opacity={0.55} />
            <circle cx={x2} cy={BOTTOM} r={4.5} fill={handColor} />
            {!keep && (
              <text
                x={(x1 + x2) / 2 + (x2 >= x1 ? 6 : -6)}
                y={midY + 3}
                textAnchor={x2 >= x1 ? 'start' : 'end'}
                className="fill-foreground font-mono text-[9px] tabular-nums"
              >
                {st > 0 ? `+${st}` : st}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
