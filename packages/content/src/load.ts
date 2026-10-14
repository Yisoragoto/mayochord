import {
  type AnyCard,
  buildTopicGraph,
  type ChordQuality,
  type ChordSymbol,
  chordCard,
  chordTones,
  closeVoicing,
  type Finger,
  type Hand,
  intervalCard,
  nameToMidi,
  noteCard,
  symbolFromNames,
  type TopicGraph,
  type TopicNode,
  transitionCardsFor,
  type VoicedNote,
  type Voicing,
} from '@mayochord/core';
import type { z } from 'zod';
import {
  type ContentPackData,
  ContentPackSchema,
  type I18nText,
  type LessonData,
  type TopicPractice,
} from './schema/pack';

export interface ChordEntry {
  id: string;
  rootName: string;
  quality: ChordQuality;
  bassName?: string;
  symbol: ChordSymbol;
  /** 拼写过的组成音，按叠置顺序 */
  tones: string[];
  reference: Voicing;
  voicings: Voicing[];
}

export interface ProgressionEntry {
  id: string;
  name: I18nText;
  key: string;
  description?: I18nText;
  steps: { chord: ChordEntry; voicing: Voicing; beats: number; anticipation: number }[];
}

/** 知识图谱里的一个主题（已解析出卡片） */
export interface TopicEntry extends TopicNode {
  title: I18nText;
  summary: I18nText;
  /** 这个主题练习的卡片（topicId 指向本主题） */
  cards: AnyCard[];
  /** 卡片的判定方式：练习内容里的 voicingMode（认音名、音程题为 any） */
  lesson: LessonData;
  /** 练习内容（跟拍主题的课程要用到进行与速度） */
  practice: TopicPractice;
}

export interface LoadedPack {
  id: string;
  version: string;
  name: I18nText;
  chords: ChordEntry[];
  chordById: ReadonlyMap<string, ChordEntry>;
  voicingById: ReadonlyMap<string, Voicing>;
  progressions: ProgressionEntry[];
  progressionById: ReadonlyMap<string, ProgressionEntry>;
  /** 每个键位的设计说明（例如"待确认"的原因） */
  voicingNotes: ReadonlyMap<string, I18nText>;
  topics: TopicEntry[];
  topicById: ReadonlyMap<string, TopicEntry>;
  graph: TopicGraph<TopicEntry>;
  /** 所有主题里的卡片 */
  cardById: ReadonlyMap<string, AnyCard>;
  /** 卡片 → 包含它的主题 */
  topicsOfCard: ReadonlyMap<string, readonly string[]>;
}

export type LoadResult = { ok: true; pack: LoadedPack } | { ok: false; issues: z.core.$ZodIssue[] };

function toVoicing(v: ContentPackData['voicings'][number]): Voicing {
  const notes: VoicedNote[] = v.notes
    .map((n) => {
      const midi = nameToMidi(n.pitch) as number;
      const note: VoicedNote = { name: n.pitch, midi, hand: n.hand as Hand };
      if (n.finger !== undefined) note.finger = n.finger as Finger;
      return note;
    })
    .sort((a, b) => a.midi - b.midi);
  return { id: v.id, chordId: v.chordId, notes, status: v.status };
}

/** 校验并加载内容包。校验失败时返回 Zod 的问题列表（含路径与中文说明）。 */
export function loadContentPack(input: unknown): LoadResult {
  const parsed = ContentPackSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues };
  const data = parsed.data;

  const voicingById = new Map(data.voicings.map((v) => [v.id, toVoicing(v)]));
  const voicingNotes = new Map<string, I18nText>();
  for (const v of data.voicings) if (v.note) voicingNotes.set(v.id, v.note);

  // 没有给键位的和弦：自动生成密集排列的参考键位
  for (const c of data.chords) {
    if (data.voicings.some((v) => v.chordId === c.id)) continue;
    const id = `${c.id}-ref`;
    voicingById.set(id, {
      id,
      chordId: c.id,
      notes: closeVoicing(c.root, c.quality, c.bass),
      status: 'generated',
    });
  }

  const chords: ChordEntry[] = data.chords.map((c) => {
    const own = data.voicings.filter((v) => v.chordId === c.id);
    const voicings =
      own.length > 0
        ? own.map((v) => voicingById.get(v.id) as Voicing)
        : [voicingById.get(`${c.id}-ref`) as Voicing];
    const refId = own.length > 0 ? (own.find((v) => v.reference)?.id as string) : `${c.id}-ref`;
    const entry: ChordEntry = {
      id: c.id,
      rootName: c.root,
      quality: c.quality,
      symbol: symbolFromNames(c.root, c.quality, c.bass),
      tones: chordTones(c.root, c.quality),
      reference: voicingById.get(refId) as Voicing,
      voicings,
    };
    if (c.bass !== undefined) entry.bassName = c.bass;
    return entry;
  });
  const chordById = new Map(chords.map((c) => [c.id, c]));

  const progressions: ProgressionEntry[] = data.progressions.map((p) => {
    const entry: ProgressionEntry = {
      id: p.id,
      name: p.name,
      key: p.key,
      steps: p.steps.map((s) => ({
        chord: chordById.get(s.chordId) as ChordEntry,
        voicing: voicingById.get(s.voicingId) as Voicing,
        beats: s.beats,
        anticipation: s.anticipation,
      })),
    };
    if (p.description) entry.description = p.description;
    return entry;
  });

  const progressionById = new Map(progressions.map((p) => [p.id, p]));
  const topics: TopicEntry[] = data.topics.map((t) => {
    const pr = t.practice;
    let cards: AnyCard[];
    switch (pr.kind) {
      case 'notes':
        cards = pr.notes.map((n) => noteCard(n, t.id));
        break;
      case 'intervals':
        cards = pr.items.map((i) => intervalCard(i.root, i.interval, t.id));
        break;
      case 'chords':
        cards = [...new Set(pr.chords)].map((id) =>
          chordCard(id, { voicingMode: pr.voicingMode, topicId: t.id }),
        );
        break;
      case 'transitions': {
        const seen = new Set<string>();
        cards = pr.progressions
          .flatMap((pid) =>
            transitionCardsFor(
              (progressionById.get(pid) as ProgressionEntry).steps.map((s) => s.chord.id),
              { cyclic: true, voicingMode: pr.voicingMode, topicId: t.id },
            ),
          )
          .filter((c) => {
            if (seen.has(c.id)) return false;
            seen.add(c.id);
            return true;
          });
        break;
      }
      case 'progression':
        cards = transitionCardsFor(
          (progressionById.get(pr.progression) as ProgressionEntry).steps.map((s) => s.chord.id),
          { cyclic: true, voicingMode: pr.voicingMode, topicId: t.id },
        );
        break;
    }
    const entry: TopicEntry = {
      id: t.id,
      title: t.title,
      summary: t.summary,
      prerequisites: t.prerequisites,
      encompasses: t.encompasses,
      cards,
      lesson: t.lesson,
      practice: t.practice,
    };
    if (t.interferenceGroup !== undefined) entry.interferenceGroup = t.interferenceGroup;
    return entry;
  });
  const cardById = new Map<string, AnyCard>();
  const topicsOfCard = new Map<string, string[]>();
  for (const t of topics) {
    for (const c of t.cards) {
      if (!cardById.has(c.id)) cardById.set(c.id, c);
      topicsOfCard.set(c.id, [...(topicsOfCard.get(c.id) ?? []), t.id]);
    }
  }

  return {
    ok: true,
    pack: {
      id: data.id,
      version: data.version,
      name: data.name,
      chords,
      chordById,
      voicingById,
      progressions,
      progressionById,
      voicingNotes,
      topics,
      topicById: new Map(topics.map((t) => [t.id, t])),
      graph: buildTopicGraph(topics),
      cardById,
      topicsOfCard,
    },
  };
}

/** 把校验问题格式化成便于阅读的中文文本（用于导入失败提示）。 */
export function formatIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.map((i) => `${i.path.length ? `${i.path.join('.')}：` : ''}${i.message}`);
}
