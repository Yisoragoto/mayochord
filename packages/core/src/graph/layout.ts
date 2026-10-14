import type { TopicGraph } from './topic-graph';

/**
 * 分层布局（图谱页用；图谱只有几十个节点，不需要引入布局库）：
 * 1. 层 = 最长先修链长度（没有先修的在第 0 层）；
 * 2. 层内顺序用重心法（barycenter）上下来回扫几遍，减少连线交叉；
 * 3. 每层居中排列。
 * orientation 'LR'：层沿 x 轴（电脑横屏）；'TB'：层沿 y 轴（手机竖屏）。
 */
export interface LayoutOptions {
  orientation: 'LR' | 'TB';
  nodeWidth: number;
  nodeHeight: number;
  /** 层与层之间的间距 */
  rankGap: number;
  /** 同层节点之间的间距 */
  nodeGap: number;
  sweeps?: number;
}

export interface LaidOutNode {
  id: string;
  rank: number;
  /** 层内序号 */
  order: number;
  /** 左上角坐标 */
  x: number;
  y: number;
}

export interface LaidOutEdge {
  from: string;
  to: string;
  /** 起点（源节点出口）与终点（目标节点入口） */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface GraphLayout {
  nodes: Map<string, LaidOutNode>;
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

export function topicRanks(graph: TopicGraph): Map<string, number> {
  const rank = new Map<string, number>();
  for (const id of graph.order) {
    const prereqs = graph.byId.get(id)?.prerequisites ?? [];
    rank.set(id, prereqs.length === 0 ? 0 : 1 + Math.max(...prereqs.map((p) => rank.get(p) ?? 0)));
  }
  return rank;
}

export function layoutTopicGraph(graph: TopicGraph, opts: LayoutOptions): GraphLayout {
  const rank = topicRanks(graph);
  const layers: string[][] = [];
  for (const id of graph.order) {
    const r = rank.get(id) as number;
    const layer = layers[r] ?? [];
    layer.push(id);
    layers[r] = layer;
  }

  const pos = new Map<string, number>();
  const reindex = () => {
    for (const layer of layers) {
      layer.forEach((id, i) => {
        pos.set(id, i);
      });
    }
  };
  reindex();
  const bary = (ids: readonly string[], fallback: number) =>
    ids.length === 0 ? fallback : ids.reduce((s, id) => s + (pos.get(id) ?? 0), 0) / ids.length;

  const sweeps = opts.sweeps ?? 4;
  for (let s = 0; s < sweeps; s++) {
    // 向下：按先修的平均位置排序
    for (let r = 1; r < layers.length; r++) {
      const layer = layers[r] as string[];
      const key = new Map(
        layer.map((id) => [id, bary(graph.byId.get(id)?.prerequisites ?? [], pos.get(id) ?? 0)]),
      );
      layer.sort((a, b) => (key.get(a) as number) - (key.get(b) as number));
      reindex();
    }
    // 向上：按依赖它的主题的平均位置排序
    for (let r = layers.length - 2; r >= 0; r--) {
      const layer = layers[r] as string[];
      const key = new Map(
        layer.map((id) => [id, bary(graph.dependents.get(id) ?? [], pos.get(id) ?? 0)]),
      );
      layer.sort((a, b) => (key.get(a) as number) - (key.get(b) as number));
      reindex();
    }
  }

  const { nodeWidth: w, nodeHeight: h, rankGap, nodeGap } = opts;
  const lr = opts.orientation === 'LR';
  const along = lr ? h : w; // 同层方向上的节点尺寸
  const across = lr ? w : h; // 层方向上的节点尺寸
  const maxLayer = Math.max(...layers.map((l) => l.length));
  const span = maxLayer * along + (maxLayer - 1) * nodeGap;

  const nodes = new Map<string, LaidOutNode>();
  layers.forEach((layer, r) => {
    const layerSpan = layer.length * along + (layer.length - 1) * nodeGap;
    const offset = (span - layerSpan) / 2;
    layer.forEach((id, i) => {
      const a = r * (across + rankGap);
      const b = offset + i * (along + nodeGap);
      nodes.set(id, { id, rank: r, order: i, x: lr ? a : b, y: lr ? b : a });
    });
  });

  const edges: LaidOutEdge[] = [];
  for (const n of graph.nodes) {
    const to = nodes.get(n.id) as LaidOutNode;
    for (const p of n.prerequisites) {
      const from = nodes.get(p) as LaidOutNode;
      edges.push(
        lr
          ? { from: p, to: n.id, x1: from.x + w, y1: from.y + h / 2, x2: to.x, y2: to.y + h / 2 }
          : { from: p, to: n.id, x1: from.x + w / 2, y1: from.y + h, x2: to.x + w / 2, y2: to.y },
      );
    }
  }

  const ranks = layers.length;
  const depth = ranks * across + (ranks - 1) * rankGap;
  return { nodes, edges, width: lr ? depth : span, height: lr ? span : depth };
}
