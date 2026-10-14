import { encompassedWeights, encompassingWeights, type TopicGraph } from '../graph/topic-graph';
import type { TopicProgress } from '../graph/topic-progress';

/**
 * 隐式重复（规格 6.4，参考 Math Academy 的 Fractional Implicit Repetition，简化实现）：
 * - 一个主题练习成功 → 沿包含关系向下，被包含的（已掌握的）主题得到部分正信用，权重逐级相乘衰减；
 * - 一个主题练习失败 → 沿包含关系向上，包含它的（已掌握的）主题得到负信用。
 * 信用怎么折算成复习（满 1 记一次、过早打折扣）见 applyTopicLog。
 */
export interface ImplicitCredit {
  topicId: string;
  weight: number;
  positive: boolean;
}

export function implicitCredits(
  graph: TopicGraph,
  topicId: string,
  passed: boolean,
  progress: ReadonlyMap<string, TopicProgress>,
  minWeight = 0.05,
): ImplicitCredit[] {
  const weights = passed
    ? encompassedWeights(graph, topicId, minWeight)
    : encompassingWeights(graph, topicId, minWeight);
  const out: ImplicitCredit[] = [];
  for (const id of graph.order) {
    const w = weights.get(id);
    if (w === undefined || progress.get(id)?.masteredAt == null) continue;
    out.push({ topicId: id, weight: Math.round(w * 1000) / 1000, positive: passed });
  }
  return out;
}
