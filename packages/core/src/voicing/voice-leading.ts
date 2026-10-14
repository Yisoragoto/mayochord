/** 声部进行：前后两个和弦的音一一配对。from / to 为 null 表示新增或消失的声部。 */
export interface VoiceMove {
  from: number | null;
  to: number | null;
  /** to - from；新增或消失的声部为 null */
  semitones: number | null;
}

export interface VoiceLeading {
  moves: VoiceMove[];
  /** 保持不动的共同音 */
  common: number[];
  /** 配对声部的移动总量（半音） */
  total: number;
  /** 单个声部的最大移动量 */
  maxMove: number;
}

function* permutations<T>(items: readonly T[], k: number): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest, k - 1)) yield [items[i] as T, ...p];
  }
}

/**
 * 求移动总量最小的配对（声部数很少，直接枚举）。总量相同时取最大单步移动更小的。
 * 两边音数不同时，多出来的音作为新增（from = null）或消失（to = null）的声部。
 */
export function voiceLeading(from: readonly number[], to: readonly number[]): VoiceLeading {
  const a = [...from].sort((x, y) => x - y);
  const b = [...to].sort((x, y) => x - y);
  const swap = a.length > b.length;
  const small = swap ? b : a;
  const large = swap ? a : b;

  let best: { pairs: [number, number][]; total: number; max: number } | null = null;
  for (const perm of permutations(large, small.length)) {
    let total = 0;
    let max = 0;
    const pairs: [number, number][] = [];
    for (let i = 0; i < small.length; i++) {
      const s = small[i] as number;
      const l = perm[i] as number;
      const d = Math.abs(l - s);
      total += d;
      max = Math.max(max, d);
      pairs.push(swap ? [l, s] : [s, l]);
    }
    if (!best || total < best.total || (total === best.total && max < best.max)) {
      best = { pairs, total, max };
    }
  }

  const pairs = best?.pairs ?? [];
  const usedLarge = new Set(pairs.map(([f, t]) => (swap ? f : t)));
  const moves: VoiceMove[] = pairs.map(([f, t]) => ({ from: f, to: t, semitones: t - f }));
  for (const n of large) {
    if (usedLarge.has(n)) continue;
    moves.push(
      swap ? { from: n, to: null, semitones: null } : { from: null, to: n, semitones: null },
    );
  }
  moves.sort((x, y) => (x.from ?? x.to ?? 0) - (y.from ?? y.to ?? 0));
  return {
    moves,
    common: moves.filter((m) => m.semitones === 0).map((m) => m.from as number),
    total: best?.total ?? 0,
    maxMove: best?.max ?? 0,
  };
}
