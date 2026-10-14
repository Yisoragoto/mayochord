/**
 * 卡片（规格 6.3）。卡片由内容（和弦、进行）派生，不入库；ID 是确定性的，
 * 记忆状态和作答日志都按卡片 ID 关联。
 *
 * ID 只包含"测量的是什么"（和弦、提示方式、调、键位要求），不包含 topicId：
 * 不同主题里出现的同一个"看 Am 弹 Am"共享同一份记忆状态。topicId 只表示卡片归属哪个主题。
 */
/** 题面：和弦名 / 文字名称（12 调构建，如"E♭ 小三和弦"）/ 听声音 / 五线谱 / 级数 */
export type Cue = 'name' | 'spelled' | 'audio' | 'staff' | 'roman';
/** any = 任意转位都算对（宽松判定）；reference = 必须弹参考键位（严格判定） */
export type VoicingMode = 'any' | 'reference';

export interface ChordCard {
  kind: 'chord';
  id: string;
  topicId: string | null;
  chordId: string;
  cue: Cue;
  /** 调：级数提示（cue = 'roman'）与调性语境里的听辨（cue = 'audio'）需要；其他为 null */
  key: string | null;
  voicingMode: VoicingMode;
}

export interface TransitionCard {
  kind: 'transition';
  id: string;
  topicId: string | null;
  fromChordId: string;
  toChordId: string;
  voicingMode: VoicingMode;
}

/** 认音名：弹出任意八度的这个音 */
export interface NoteCard {
  kind: 'note';
  id: string;
  topicId: string | null;
  /** 不带八度的音名（ASCII），例如 'Eb' */
  note: string;
}

/** 音程：从 root 向上弹出 interval，例如 E 上方小二度（半音）= E F */
export type IntervalName = 'm2' | 'M2' | 'm3' | 'M3' | 'P4' | 'P5';

export interface IntervalCard {
  kind: 'interval';
  id: string;
  topicId: string | null;
  root: string;
  interval: IntervalName;
}

export type AnyCard = ChordCard | TransitionCard | NoteCard | IntervalCard;

export function chordCardId(
  chordId: string,
  cue: Cue,
  voicingMode: VoicingMode,
  key: string | null = null,
): string {
  return `chord:${chordId}:${cue}${key ? `@${key}` : ''}:${voicingMode}`;
}

export function transitionCardId(from: string, to: string, voicingMode: VoicingMode): string {
  return `transition:${from}>${to}:${voicingMode}`;
}

export function chordCard(
  chordId: string,
  opts: {
    cue?: Cue;
    voicingMode?: VoicingMode;
    key?: string | null;
    topicId?: string | null;
  } = {},
): ChordCard {
  const cue = opts.cue ?? 'name';
  const voicingMode = opts.voicingMode ?? 'any';
  const key = opts.key ?? null;
  return {
    kind: 'chord',
    id: chordCardId(chordId, cue, voicingMode, key),
    topicId: opts.topicId ?? null,
    chordId,
    cue,
    key,
    voicingMode,
  };
}

export function transitionCard(
  from: string,
  to: string,
  opts: { voicingMode?: VoicingMode; topicId?: string | null } = {},
): TransitionCard {
  const voicingMode = opts.voicingMode ?? 'any';
  return {
    kind: 'transition',
    id: transitionCardId(from, to, voicingMode),
    topicId: opts.topicId ?? null,
    fromChordId: from,
    toChordId: to,
    voicingMode,
  };
}

const slugNote = (name: string) => name.toLowerCase().replace('#', 's');

export function noteCardId(note: string): string {
  return `note:${slugNote(note)}`;
}

export function noteCard(note: string, topicId: string | null = null): NoteCard {
  return { kind: 'note', id: noteCardId(note), topicId, note };
}

export function intervalCardId(root: string, interval: IntervalName): string {
  return `interval:${slugNote(root)}:${interval}`;
}

export function intervalCard(
  root: string,
  interval: IntervalName,
  topicId: string | null = null,
): IntervalCard {
  return { kind: 'interval', id: intervalCardId(root, interval), topicId, root, interval };
}

/** 一组和弦 → 每个和弦一张卡片（去重，保持顺序）。 */
export function chordCardsFor(
  chordIds: readonly string[],
  opts: { cue?: Cue; voicingMode?: VoicingMode; topicId?: string | null } = {},
): ChordCard[] {
  return [...new Set(chordIds)].map((id) => chordCard(id, opts));
}

/**
 * 一条和弦序列 → 相邻和弦之间的切换卡片（去重，保持顺序）。
 * cyclic = true 时包含最后一个回到第一个（进行循环练习时会弹到）。相同和弦相连不算切换。
 */
export function transitionCardsFor(
  sequence: readonly string[],
  opts: { cyclic?: boolean; voicingMode?: VoicingMode; topicId?: string | null } = {},
): TransitionCard[] {
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < sequence.length; i++) {
    pairs.push([sequence[i] as string, sequence[i + 1] as string]);
  }
  if (opts.cyclic && sequence.length > 1) {
    pairs.push([sequence[sequence.length - 1] as string, sequence[0] as string]);
  }
  const seen = new Set<string>();
  const out: TransitionCard[] = [];
  for (const [from, to] of pairs) {
    if (from === to) continue;
    const card = transitionCard(from, to, opts);
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    out.push(card);
  }
  return out;
}

/** 卡片涉及的和弦（用于"相邻两题不要是同一个和弦"等规则）。 */
export function cardChords(card: AnyCard): string[] {
  if (card.kind === 'chord') return [card.chordId];
  if (card.kind === 'transition') return [card.fromChordId, card.toChordId];
  return [];
}
