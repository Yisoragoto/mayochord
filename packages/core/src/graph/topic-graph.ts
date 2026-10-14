/**
 * 知识图谱（规格 6.1）：主题节点 + 两种关系。
 * - 先修 prerequisites：先掌握 A 才能学 B（用于解锁）；
 * - 包含 encompasses：练 B 时也在练 A 的一部分，权重 0–1（用于隐式重复，默认不设 = 0）；
 * - 干扰组 interferenceGroup：同组的新主题不在同一天引入（例如 M7 与 7）。
 */
export interface TopicNode {
  id: string;
  prerequisites: readonly string[];
  encompasses: readonly { topicId: string; weight: number }[];
  interferenceGroup?: string;
}

export interface TopicGraph<T extends TopicNode = TopicNode> {
  nodes: readonly T[];
  byId: ReadonlyMap<string, T>;
  /** 拓扑顺序（先修在前；同层保持内容包里的顺序） */
  order: readonly string[];
  /** 先修 → 依赖它的主题 */
  dependents: ReadonlyMap<string, readonly string[]>;
}

/** 检查图谱：引用存在、没有自环、权重在 0–1、先修关系无环。返回问题列表（中文）。 */
export function validateTopicGraph(nodes: readonly TopicNode[]): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) issues.push(`重复的主题 ID：${n.id}`);
    ids.add(n.id);
  }
  for (const n of nodes) {
    for (const p of n.prerequisites) {
      if (p === n.id) issues.push(`${n.id} 不能以自己为先修`);
      else if (!ids.has(p)) issues.push(`${n.id} 的先修主题不存在：${p}`);
    }
    for (const e of n.encompasses) {
      if (e.topicId === n.id) issues.push(`${n.id} 不能包含自己`);
      else if (!ids.has(e.topicId)) issues.push(`${n.id} 包含的主题不存在：${e.topicId}`);
      if (!(e.weight >= 0 && e.weight <= 1)) issues.push(`${n.id} → ${e.topicId} 的权重应在 0–1`);
    }
  }
  if (issues.length === 0 && topologicalOrder(nodes) === null) issues.push('先修关系有环');
  return issues;
}

/** Kahn 算法；有环时返回 null。 */
function topologicalOrder(nodes: readonly TopicNode[]): string[] | null {
  const indeg = new Map(nodes.map((n) => [n.id, n.prerequisites.length]));
  const deps = new Map<string, string[]>();
  for (const n of nodes)
    for (const p of n.prerequisites) deps.set(p, [...(deps.get(p) ?? []), n.id]);
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const ready = nodes.filter((n) => n.prerequisites.length === 0).map((n) => n.id);
  const out: string[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => (index.get(a) as number) - (index.get(b) as number));
    const id = ready.shift() as string;
    out.push(id);
    for (const d of deps.get(id) ?? []) {
      const k = (indeg.get(d) as number) - 1;
      indeg.set(d, k);
      if (k === 0) ready.push(d);
    }
  }
  return out.length === nodes.length ? out : null;
}

export function buildTopicGraph<T extends TopicNode>(nodes: readonly T[]): TopicGraph<T> {
  const issues = validateTopicGraph(nodes);
  if (issues.length > 0) throw new Error(issues.join('\n'));
  const dependents = new Map<string, string[]>();
  for (const n of nodes)
    for (const p of n.prerequisites) dependents.set(p, [...(dependents.get(p) ?? []), n.id]);
  return {
    nodes,
    byId: new Map(nodes.map((n) => [n.id, n])),
    order: topologicalOrder(nodes) as string[],
    dependents,
  };
}

/**
 * 沿包含关系向下：练 topicId 时，每个被（直接或间接）包含的主题得到的权重。
 * 间接包含的权重是路径上权重的乘积（逐级衰减），多条路径取最大值；小于 minWeight 的忽略。
 */
export function encompassedWeights(
  graph: TopicGraph,
  topicId: string,
  minWeight = 0.05,
): Map<string, number> {
  const out = new Map<string, number>();
  const visit = (id: string, w: number) => {
    for (const e of graph.byId.get(id)?.encompasses ?? []) {
      const next = w * e.weight;
      if (next < minWeight || next <= (out.get(e.topicId) ?? 0)) continue;
      out.set(e.topicId, next);
      visit(e.topicId, next);
    }
  };
  visit(topicId, 1);
  out.delete(topicId);
  return out;
}

/** 沿包含关系向上：哪些主题（直接或间接）包含 topicId，以及权重。 */
export function encompassingWeights(
  graph: TopicGraph,
  topicId: string,
  minWeight = 0.05,
): Map<string, number> {
  const parents = new Map<string, { topicId: string; weight: number }[]>();
  for (const n of graph.nodes) {
    for (const e of n.encompasses) {
      parents.set(e.topicId, [
        ...(parents.get(e.topicId) ?? []),
        { topicId: n.id, weight: e.weight },
      ]);
    }
  }
  const out = new Map<string, number>();
  const visit = (id: string, w: number) => {
    for (const p of parents.get(id) ?? []) {
      const next = w * p.weight;
      if (next < minWeight || next <= (out.get(p.topicId) ?? 0)) continue;
      out.set(p.topicId, next);
      visit(p.topicId, next);
    }
  };
  visit(topicId, 1);
  out.delete(topicId);
  return out;
}

/** 所有（直接或间接）先修主题 */
export function allPrerequisites(graph: TopicGraph, topicId: string): Set<string> {
  const out = new Set<string>();
  const visit = (id: string) => {
    for (const p of graph.byId.get(id)?.prerequisites ?? []) {
      if (out.has(p)) continue;
      out.add(p);
      visit(p);
    }
  };
  visit(topicId);
  return out;
}
