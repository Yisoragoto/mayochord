/**
 * 作答日志（规格 6.3）。只追加，不修改、不删除。
 * 卡片的记忆状态、统计数据都可以由日志重放得到。
 */
export type EvidenceKind = 'explicit' | 'implicit';
export type CardKind = 'chord' | 'transition' | 'topic';
export type InputSourceKind = 'midi' | 'onscreen' | 'keyboard' | 'manual';
/** FSRS 评分：1 Again、2 Hard、3 Good、4 Easy */
export type Rating = 1 | 2 | 3 | 4;

export interface ReviewLog {
  /** 唯一 ID（UUID） */
  id: string;
  /** 记录时间（Unix 毫秒，墙上时钟） */
  ts: number;
  sessionId: string | null;
  cardId: string;
  cardKind: CardKind;
  /** 产生这条证据的练习类型，例如 'name-to-chord'、'transition' */
  drillType: string;
  /** 显式 = 直接测量到；隐式 = 由包含关系推断的部分复习信用 */
  evidence: EvidenceKind;
  /** 证据权重：显式为 1，隐式为 0–1 */
  weight: number;
  correct: boolean;
  /** 反应时间（毫秒）；无法测量时为 null */
  reactionMs: number | null;
  /** 多按的音、少按的音（MIDI 号） */
  extraNotes: number[];
  missingNotes: number[];
  /** 齐整度：和弦内各音按下时间的最大差（毫秒） */
  spreadMs: number | null;
  /** 相对节拍的偏差（毫秒）；没有节拍器时为 null */
  beatOffsetMs: number | null;
  hintUsed: boolean;
  rating: Rating | null;
  /** 作答所用输入源。屏幕键盘、电脑键盘的齐整度没有意义 */
  inputSource: InputSourceKind;
  /** 产生日志时内容包的版本，便于以后迁移 */
  contentVersion: string;
}
