import { allPrerequisites, type TopicGraph } from './topic-graph';

/**
 * 诊断测试（规格 6.6）：首次使用时可选，从图谱中间层的主题开始测，快速定位起点。
 * - 通过一个主题 → 推断它和它的全部先修主题都已掌握；
 * - 没通过 → 依赖它的主题（全部后继）都推断为没掌握；
 * - 每次选"还不确定"的主题里最能二分的那个：它的不确定先修数与不确定后继数中较小的一个最大
 *   （测一题能排除最多的不确定），相同时选图谱顺序靠前的。
 * 纯函数：状态不可变，调用方每测完一个主题调用 recordProbe。
 */
export interface DiagnosticState {
  /** 直接测过并通过的主题 */
  passed: string[];
  /** 直接测过没通过的主题 */
  failed: string[];
  /** 推断为已掌握（含直接通过的） */
  known: string[];
  /** 推断为没掌握（含直接没通过的） */
  unknown: string[];
}

export const emptyDiagnostic = (): DiagnosticState => ({
  passed: [],
  failed: [],
  known: [],
  unknown: [],
});

/** 依赖 id 的全部主题（后继，传递闭包） */
export function allDependents(graph: TopicGraph, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [...(graph.dependents.get(id) ?? [])];
  while (stack.length > 0) {
    const d = stack.pop() as string;
    if (out.has(d)) continue;
    out.add(d);
    stack.push(...(graph.dependents.get(d) ?? []));
  }
  return out;
}

/** 还不确定的主题（只在 candidates 里考虑；例如排除不适合诊断的主题） */
export function undecided(
  graph: TopicGraph,
  state: DiagnosticState,
  candidates: readonly string[] = graph.order,
): string[] {
  const decided = new Set([...state.known, ...state.unknown]);
  const allowed = new Set(candidates);
  return graph.order.filter((id) => allowed.has(id) && !decided.has(id));
}

/** 下一个要测的主题；都确定了（或没有可测的）返回 null */
export function nextProbe(
  graph: TopicGraph,
  state: DiagnosticState,
  candidates: readonly string[] = graph.order,
): string | null {
  const open = undecided(graph, state, candidates);
  const openSet = new Set(open);
  let best: { id: string; score: number } | null = null;
  for (const id of open) {
    const up = [...allPrerequisites(graph, id)].filter((x) => openSet.has(x)).length;
    const down = [...allDependents(graph, id)].filter((x) => openSet.has(x)).length;
    const score = Math.min(up, down) * 1000 + up + down;
    if (!best || score > best.score) best = { id, score };
  }
  return best?.id ?? null;
}

/** 记下一个主题的测试结果，推断其他主题 */
export function recordProbe(
  graph: TopicGraph,
  state: DiagnosticState,
  id: string,
  passed: boolean,
): DiagnosticState {
  const known = new Set(state.known);
  const unknown = new Set(state.unknown);
  if (passed) {
    for (const x of [id, ...allPrerequisites(graph, id)]) {
      known.add(x);
      unknown.delete(x);
    }
  } else {
    for (const x of [id, ...allDependents(graph, id)]) {
      if (!known.has(x)) unknown.add(x);
    }
  }
  const ordered = (s: Set<string>) => graph.order.filter((x) => s.has(x));
  return {
    passed: passed ? [...state.passed, id] : state.passed,
    failed: passed ? state.failed : [...state.failed, id],
    known: ordered(known),
    unknown: ordered(unknown),
  };
}
