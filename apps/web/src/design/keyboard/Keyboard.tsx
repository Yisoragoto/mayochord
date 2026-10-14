import { isBlackKey, midiToName, pitchClass } from '@mayochord/core';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useId, useMemo } from 'react';
import { cn } from '@/lib/utils';
import './keyboard.css';

export type Hand = 'left' | 'right';
export type KeyMarkKind = 'target' | 'correct' | 'extra' | 'missing';

/**
 * 键上的标记。颜色之外每种状态都有不同的形状，照顾色弱：
 * - target  目标键：实心圆（左右手不同颜色），内含指法数字
 * - correct 已按对：圆 + 对勾，琴键染色
 * - extra   多按：方块 + 叉，琴键加斜线纹理
 * - missing 少按：虚线圆环，琴键虚线描边并呼吸闪动
 */
export interface KeyMark {
  kind: KeyMarkKind;
  hand?: Hand;
  finger?: number;
}

export interface KeyboardProps {
  low: number;
  high: number;
  pressed?: ReadonlySet<number>;
  marks?: ReadonlyMap<number, KeyMark>;
  /** 在白键底部显示音名：'c' 只显示每个 C，'all' 显示所有白键 */
  labels?: 'none' | 'c' | 'all';
  className?: string;
  'aria-label'?: string;
}

const W = 24;
const H = 150;
const BW = 14;
const BH = 96;
const BED = 5;
/** 黑键相对标准位置的偏移，模仿真实钢琴黑键的不对称分布 */
const BLACK_OFFSET: Partial<Record<number, number>> = { 1: -2.5, 3: 2.5, 6: -3, 8: 0, 10: 3 };

interface KeyGeom {
  note: number;
  black: boolean;
  x: number;
}

function layout(low: number, high: number): { keys: KeyGeom[]; width: number } {
  const lo = isBlackKey(low) ? low - 1 : low;
  const hi = isBlackKey(high) ? high + 1 : high;
  const keys: KeyGeom[] = [];
  let whiteIndex = 0;
  for (let n = lo; n <= hi; n++) {
    if (isBlackKey(n)) {
      const x = whiteIndex * W - BW / 2 + (BLACK_OFFSET[pitchClass(n)] ?? 0);
      keys.push({ note: n, black: true, x });
    } else {
      keys.push({ note: n, black: false, x: whiteIndex * W });
      whiteIndex++;
    }
  }
  return { keys, width: whiteIndex * W };
}

export function Keyboard({
  low,
  high,
  pressed,
  marks,
  labels = 'c',
  className,
  'aria-label': ariaLabel,
}: KeyboardProps) {
  const uid = useId().replace(/:/g, '');
  const { keys, width } = useMemo(() => layout(low, high), [low, high]);
  const whites = keys.filter((k) => !k.black);
  const blacks = keys.filter((k) => k.black);

  const label =
    ariaLabel ??
    (pressed && pressed.size > 0
      ? `键盘，按下：${Array.from(pressed, (n) => midiToName(n)).join(' ')}`
      : '键盘');

  return (
    <svg
      viewBox={`0 0 ${width} ${H + BED}`}
      className={cn('mc-keyboard block h-auto w-full select-none', className)}
      role="img"
      aria-label={label}
    >
      <defs>
        <pattern
          id={`hatch-${uid}`}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" fill="var(--mark-extra)" opacity="0.16" />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="6"
            stroke="var(--mark-extra)"
            strokeWidth="2.2"
            opacity="0.7"
          />
        </pattern>
      </defs>
      <rect x="0" y="0" width={width} height={H + BED} rx="4" fill="var(--key-bed)" />
      <g transform={`translate(0 ${BED})`}>
        {whites.map((k) => (
          <Key
            key={k.note}
            geom={k}
            pressed={pressed?.has(k.note) ?? false}
            mark={marks?.get(k.note)}
            hatchId={`hatch-${uid}`}
            label={labelFor(k.note, labels)}
          />
        ))}
        {blacks.map((k) => (
          <Key
            key={k.note}
            geom={k}
            pressed={pressed?.has(k.note) ?? false}
            mark={marks?.get(k.note)}
            hatchId={`hatch-${uid}`}
            label={null}
          />
        ))}
      </g>
    </svg>
  );
}

function labelFor(note: number, mode: KeyboardProps['labels']): string | null {
  if (mode === 'none') return null;
  if (mode === 'c') return pitchClass(note) === 0 ? midiToName(note) : null;
  return midiToName(note).replace(/\d+$/, '');
}

interface KeyProps {
  geom: KeyGeom;
  pressed: boolean;
  mark: KeyMark | undefined;
  hatchId: string;
  label: string | null;
}

function Key({ geom, pressed, mark, hatchId, label }: KeyProps) {
  const { note, black, x } = geom;
  const w = black ? BW : W;
  const h = black ? BH : H;
  const kw = black ? w : w - 1; // 白键之间留 1px 缝
  const cx = x + kw / 2;
  const cy = black ? h - 17 : h - 24;
  const r = black ? 6.2 : 8.5;
  const kind = mark?.kind;

  return (
    <g
      className="mc-key"
      data-note={note}
      data-black={black || undefined}
      data-pressed={pressed || undefined}
      data-mark={kind}
    >
      <g className="mc-key-body">
        {black ? (
          <>
            <rect x={x} y={-2} width={kw} height={h} rx="2.5" className="mc-key-black" />
            <rect
              x={x + 2}
              y={0}
              width={kw - 4}
              height={h - 9}
              rx="1.6"
              className="mc-key-black-top"
            />
          </>
        ) : (
          <>
            <rect x={x} y={-4} width={kw} height={h + 4} rx="3" className="mc-key-white" />
            <rect x={x} y={h - 6} width={kw} height={6} rx="3" className="mc-key-white-edge" />
          </>
        )}
        {kind === 'correct' && (
          <rect x={x} y={0} width={kw} height={h} rx="3" className="mc-tint-correct" />
        )}
        {kind === 'extra' && (
          <rect x={x} y={0} width={kw} height={h} rx="3" fill={`url(#${hatchId})`} />
        )}
        {kind === 'missing' && (
          <rect
            x={x + 1.5}
            y={1.5}
            width={kw - 3}
            height={h - 3}
            rx="2.5"
            className="mc-outline-missing"
          />
        )}
        {label && (
          <text x={cx} y={h - 9} className="mc-key-label" textAnchor="middle">
            {label}
          </text>
        )}
      </g>
      <AnimatePresence>
        {mark && <Marker key={mark.kind} mark={mark} cx={cx} cy={cy} r={r} black={black} />}
      </AnimatePresence>
    </g>
  );
}

function Marker({
  mark,
  cx,
  cy,
  r,
  black,
}: {
  mark: KeyMark;
  cx: number;
  cy: number;
  r: number;
  black: boolean;
}) {
  const reduce = useReducedMotion();
  const handColor = mark.hand === 'left' ? 'var(--hand-left)' : 'var(--hand-right)';
  const fontSize = black ? 8 : 10.5;
  const finger =
    mark.finger !== undefined ? (
      <text
        x={cx}
        y={cy + fontSize * 0.36}
        textAnchor="middle"
        className="mc-finger"
        style={{ fontSize }}
        fill={mark.kind === 'missing' ? 'var(--mark-missing)' : 'var(--background)'}
      >
        {mark.finger}
      </text>
    ) : null;

  let shape: React.ReactNode;
  switch (mark.kind) {
    case 'target':
      shape = <circle cx={cx} cy={cy} r={r} fill={handColor} />;
      break;
    case 'correct':
      shape = (
        <>
          <circle cx={cx} cy={cy} r={r} fill="var(--mark-correct)" />
          {mark.finger === undefined && (
            <path
              d={`M ${cx - r * 0.45} ${cy} l ${r * 0.32} ${r * 0.34} l ${r * 0.6} ${-r * 0.7}`}
              fill="none"
              stroke="var(--background)"
              strokeWidth={black ? 1.6 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </>
      );
      break;
    case 'extra': {
      const s = r * 0.95;
      const c = r * 0.38;
      shape = (
        <>
          <rect
            x={cx - s}
            y={cy - s}
            width={s * 2}
            height={s * 2}
            rx="2"
            fill="var(--mark-extra)"
          />
          <path
            d={`M ${cx - c} ${cy - c} L ${cx + c} ${cy + c} M ${cx + c} ${cy - c} L ${cx - c} ${cy + c}`}
            stroke="var(--background)"
            strokeWidth={black ? 1.6 : 2}
            strokeLinecap="round"
          />
        </>
      );
      break;
    }
    case 'missing':
      shape = (
        <circle
          cx={cx}
          cy={cy}
          r={r - 0.8}
          fill="var(--background)"
          stroke="var(--mark-missing)"
          strokeWidth="1.8"
          strokeDasharray="3 2.2"
        />
      );
      break;
  }

  return (
    <motion.g
      initial={reduce ? false : { scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={reduce ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 700, damping: 30, mass: 0.6 }}
      style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
    >
      {shape}
      {mark.kind !== 'extra' && finger}
    </motion.g>
  );
}
