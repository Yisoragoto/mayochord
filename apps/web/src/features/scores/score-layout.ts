/**
 * 一行谱（system）的竖直排版：按这一行里实际最高、最低的音（含加线、符干）和表情记号算出每个谱表
 * 上下要留多少空间，避免与上一行、下一行或另一个谱表重叠。纯函数，单独测试。
 */
import type { Clef, NotationElement, ScoreDirection } from '@mayochord/core';

/** VexFlow 默认线距 10 px：相邻的线和间差 5 px */
export const STEP = 5;
export const STAFF_HEIGHT = 40;
/** 符干长度（约 3.5 个线距） */
const STEM = 35;
/** 表情记号一行的高度 */
export const ROW = 18;
/** 和弦名、小节号那一行 */
export const LABEL_ROW = 24;
const PAD = 6;
const LABEL_GAP = 10;

const LETTERS = 'CDEFGAB';
/** 谱表第一线（最上面那条线）的音：高音谱号 F5，低音谱号 A3，中音谱号 G4（按"字母序号 + 八度 × 7"） */
const TOP_LINE: Record<Clef, number> = { treble: 5 * 7 + 3, bass: 3 * 7 + 5, alto: 4 * 7 + 4 };

/** 音名 → 谱表上的位置（字母序号 + 八度 × 7），已按 8va 移动八度 */
export function diatonic(spelled: string, octaveShift = 0): number {
  const m = /^([A-G])[#b]*(-?\d+)$/.exec(spelled);
  if (!m) return 4 * 7;
  return (Number(m[2]) + octaveShift) * 7 + LETTERS.indexOf(m[1] as string);
}

export type RowKind = 'octave' | 'words' | 'rehearsal' | 'dynamic' | 'pedal';

export interface StaffSpace {
  /** 第一线之上要留的空间（音符、符干） */
  above: number;
  /** 第五线之下要留的空间 */
  below: number;
  /** 上方、下方的记号行（从谱表往外） */
  rowsAbove: RowKind[];
  rowsBelow: RowKind[];
}

const ABOVE_ORDER: RowKind[] = ['octave', 'dynamic', 'words', 'rehearsal'];
const BELOW_ORDER: RowKind[] = ['dynamic', 'words', 'octave', 'pedal'];

function rowKind(d: ScoreDirection): RowKind {
  if (d.kind === 'wedge') return 'dynamic';
  return d.kind;
}

/** 一行里每个谱表的上下空间 */
export function staffSpaces(
  elements: readonly NotationElement[],
  directions: readonly ScoreDirection[],
  clefs: readonly Clef[],
  staves: number,
): StaffSpace[] {
  const out: StaffSpace[] = Array.from({ length: staves }, () => ({
    above: 0,
    below: 0,
    rowsAbove: [],
    rowsBelow: [],
  }));
  for (const e of elements) {
    const s = out[e.staff - 1];
    if (!s || e.rest || e.pitches.length === 0) continue;
    const clef = e.clef ?? clefs[e.staff - 1] ?? (e.staff === 1 ? 'treble' : 'bass');
    const top = TOP_LINE[clef];
    const bottom = top - 8;
    const ds = e.pitches.map((p) => diatonic(p.spelled, e.octaveShift ?? 0));
    const hi = Math.max(...ds);
    const lo = Math.min(...ds);
    const stemUp = e.stem ? e.stem === 'up' : (hi + lo) / 2 < top - 4;
    const stem = e.type === 'whole' ? 0 : STEM;
    const marks = (e.articulations?.length ?? 0) * 10;
    s.above = Math.max(s.above, (hi - top) * STEP + (stemUp ? stem : 0) + (stemUp ? 0 : marks));
    s.below = Math.max(s.below, (bottom - lo) * STEP + (stemUp ? 0 : stem) + (stemUp ? marks : 0));
  }
  for (const d of directions) {
    const s = out[d.staff - 1];
    if (!s) continue;
    const kind = rowKind(d);
    const rows = d.placement === 'above' ? s.rowsAbove : s.rowsBelow;
    if (!rows.includes(kind)) rows.push(kind);
  }
  for (const s of out) {
    s.rowsAbove.sort((a, b) => ABOVE_ORDER.indexOf(a) - ABOVE_ORDER.indexOf(b));
    s.rowsBelow.sort((a, b) => BELOW_ORDER.indexOf(a) - BELOW_ORDER.indexOf(b));
  }
  return out;
}

export interface SystemLayout {
  /** 每个谱表第一线的 y（相对这一行的顶） */
  lineY: number[];
  /** 和弦名的底边 y（相对这一行的顶） */
  labelY: number;
  height: number;
}

/** 由上下空间算出一行里各谱表的位置和这一行的总高度 */
export function systemLayout(spaces: readonly StaffSpace[]): SystemLayout {
  const lineY: number[] = [];
  let y = LABEL_ROW;
  let labelY = LABEL_ROW;
  spaces.forEach((s, i) => {
    const aboveRows = s.rowsAbove.length * ROW;
    const above = Math.max(s.above, 0) + aboveRows + PAD;
    if (i === 0) {
      // 和弦名那一行和下面的记号（排练号的方框等）之间再留一点
      labelY = LABEL_ROW;
      y += LABEL_GAP + above;
    } else {
      const prev = spaces[i - 1] as StaffSpace;
      const prevBelow = Math.max(prev.below, 0) + prev.rowsBelow.length * ROW + PAD;
      // 两个谱表之间至少留 40 px（第五线到下一个第一线）
      y = (lineY[i - 1] as number) + STAFF_HEIGHT + Math.max(40, prevBelow + above);
    }
    lineY.push(y);
  });
  const last = spaces[spaces.length - 1] as StaffSpace;
  const height =
    (lineY[lineY.length - 1] as number) +
    STAFF_HEIGHT +
    Math.max(12, last.below + last.rowsBelow.length * ROW + PAD);
  return { lineY, labelY, height };
}

/** 记号行在谱表上方/下方第 row 行的基线 y（相对这一行的顶） */
export function rowY(
  space: StaffSpace,
  lineY: number,
  placement: 'above' | 'below',
  kind: RowKind,
): number {
  if (placement === 'above') {
    const r = space.rowsAbove.indexOf(kind);
    return lineY - Math.max(space.above, 0) - PAD - r * ROW - 4;
  }
  const r = space.rowsBelow.indexOf(kind);
  return lineY + STAFF_HEIGHT + Math.max(space.below, 0) + PAD + r * ROW + 12;
}
