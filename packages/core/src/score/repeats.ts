/**
 * 反复记号展开（规格第 10 节第 8 条，M8）：前后反复（含反复次数）、跳房子结尾、
 * D.C. / D.S. / To Coda / Fine。只认 MusicXML 里的 <sound> 跳转属性和 <segno/>、<coda/> 记号。
 */

/** 一个小节上与演奏顺序有关的记号 */
export interface MeasureFlow {
  /** 小节开头有前反复记号 */
  repeatStart: boolean;
  /** 小节末尾有后反复记号：这一段一共弹几遍（0 = 没有） */
  repeatEnd: number;
  /** 这个小节属于第几个结尾（跳房子），例如 [1] 或 [1, 2]；不是结尾为 null */
  endings: number[] | null;
  segno: boolean;
  coda: boolean;
  /** 小节末尾：D.C.（回到开头） */
  daCapo: boolean;
  /** 小节末尾：D.S.（回到 segno） */
  dalSegno: boolean;
  /** 跳转之后：弹完这个小节跳到 coda */
  toCoda: boolean;
  /** 跳转之后：弹到这个小节为止 */
  fine: boolean;
}

export const EMPTY_FLOW: MeasureFlow = {
  repeatStart: false,
  repeatEnd: 0,
  endings: null,
  segno: false,
  coda: false,
  daCapo: false,
  dalSegno: false,
  toCoda: false,
  fine: false,
};

/** 'ending' 的 number 属性："1"、"1, 2"、"1 2" → [1, 2] */
export function parseEndingNumbers(text: string): number[] {
  return text
    .split(/[\s,]+/)
    .map((x) => Number.parseInt(x, 10))
    .filter((x) => Number.isFinite(x) && x > 0);
}

export function hasFlow(flows: readonly (MeasureFlow | undefined)[]): boolean {
  return flows.some(
    (f) =>
      f !== undefined &&
      (f.repeatStart || f.repeatEnd > 0 || f.endings !== null || f.daCapo || f.dalSegno),
  );
}

/**
 * 按演奏顺序列出小节下标。规则（与常见记谱软件一致）：
 * - 后反复跳回最近的前反复（没有时回到开头或上一个反复结束之后）；
 * - 第 n 遍只弹包含 n 的结尾；
 * - D.C. / D.S. 只跳一次，跳转之后不再反复、走最后一个结尾，遇到 Fine 结束、遇到 To Coda 跳到 coda。
 */
export function playbackOrder(flows: readonly (MeasureFlow | undefined)[]): number[] {
  const n = flows.length;
  const flow = (i: number) => flows[i] ?? EMPTY_FLOW;
  // 每段连续的结尾里最大的编号（跳转之后走这一个）
  const lastEnding = new Map<number, number>();
  for (let i = 0; i < n; ) {
    if (!flow(i).endings) {
      i++;
      continue;
    }
    let j = i;
    let max = 0;
    while (j < n && flow(j).endings) {
      max = Math.max(max, ...(flow(j).endings as number[]));
      j++;
    }
    for (let k = i; k < j; k++) lastEnding.set(k, max);
    i = j;
  }
  const segno = flows.findIndex((f) => f?.segno);

  const out: number[] = [];
  const counts = new Map<number, number>();
  const usedJumps = new Set<number>();
  let i = 0;
  let repeatStart = 0;
  let pass = 1;
  let jumped = false;
  let viaRepeat = false;
  let inEndings = false;
  const limit = n * 8 + 16;
  while (i < n && out.length < limit) {
    const f = flow(i);
    if (f.repeatStart && !viaRepeat) {
      repeatStart = i;
      pass = 1;
    }
    viaRepeat = false;
    if (f.endings) {
      const play = jumped ? f.endings.includes(lastEnding.get(i) ?? 1) : f.endings.includes(pass);
      inEndings = true;
      if (!play) {
        i++;
        continue;
      }
    } else if (inEndings) {
      // 离开跳房子：之后的后反复从这里算起
      inEndings = false;
      pass = 1;
      if (!f.repeatStart) repeatStart = i;
    }
    out.push(i);
    if (jumped && f.fine) break;
    if (jumped && f.toCoda && !usedJumps.has(i)) {
      usedJumps.add(i);
      const coda = flows.findIndex((x, k) => k > i && x?.coda);
      if (coda >= 0) {
        i = coda;
        continue;
      }
    }
    if (f.repeatEnd > 0 && !jumped) {
      const done = counts.get(i) ?? 1;
      if (done < f.repeatEnd) {
        counts.set(i, done + 1);
        pass = done + 1;
        i = repeatStart;
        viaRepeat = true;
        inEndings = false;
        continue;
      }
      counts.delete(i);
      pass = 1;
      repeatStart = i + 1;
    }
    if ((f.daCapo || f.dalSegno) && !usedJumps.has(i)) {
      usedJumps.add(i);
      jumped = true;
      pass = 1;
      inEndings = false;
      i = f.dalSegno && segno >= 0 ? segno : 0;
      continue;
    }
    i++;
  }
  return out;
}

/**
 * 练习一段小节（from…to，含两端）时弹哪些小节：
 * 按演奏顺序，从 from 第一次出现到 to 最后一次出现（to 是最后一个小节时一直到演奏结束，
 * 包括 D.S. 之后的部分），只留这段里的小节；只选一个小节时弹一遍。
 * 不展开（expand = false）或找不到时按谱面顺序。
 */
export function practiceSequence(
  order: readonly number[],
  from: number,
  to: number,
  expand: boolean,
  toEnd = false,
): number[] {
  const straight = Array.from({ length: to - from + 1 }, (_, k) => from + k);
  if (!expand || from === to) return straight;
  const first = order.indexOf(from);
  const last = toEnd ? order.length - 1 : order.lastIndexOf(to);
  if (first < 0 || last < first) return straight;
  return order.slice(first, last + 1).filter((m) => m >= from && m <= to);
}
