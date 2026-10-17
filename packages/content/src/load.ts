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
  nameToPitchClass,
  nearestBass,
  noteCard,
  parseNoteName,
  parseRhythm,
  type RhythmPattern,
  rankRightHandVoicings,
  rhythmCard,
  staffNoteCard,
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

/** 节奏型（已解析） */
export interface RhythmEntry {
  id: string;
  time: [number, number];
  bpm: number;
  notes: string;
  pattern: RhythmPattern;
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
  rhythms: RhythmEntry[];
  rhythmById: ReadonlyMap<string, RhythmEntry>;
  /** 每个键位的设计说明（例如"待确认"的原因） */
  voicingNotes: ReadonlyMap<string, I18nText>;
  topics: TopicEntry[];
  topicById: ReadonlyMap<string, TopicEntry>;
  graph: TopicGraph<TopicEntry>;
  /** 所有主题里的卡片 */
  cardById: ReadonlyMap<string, AnyCard>;
  /** 卡片 → 包含它的主题 */
  topicsOfCard: ReadonlyMap<string, readonly string[]>;
  /** 听声音的卡片 → 作答选项（和弦 ID） */
  choicesByCard: ReadonlyMap<string, readonly string[]>;
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

/** MIDI 号按给定的音名拼写写出带八度的名字：('Bb', 70) → 'Bb4'，('Cb', 59) → 'Cb4' */
function nameAt(name: string, midi: number): string {
  const n = parseNoteName(name);
  const letterPc = nameToPitchClass(n?.letter ?? 'C') ?? 0;
  const octave = Math.round((midi - letterPc - (n?.alter ?? 0)) / 12) - 1;
  return `${name}${octave}`;
}

/**
 * 进行里没有给键位的步：按就近转位从上一个和弦推出（右手在 G3–G5 内移动最少、左手低音就近），
 * 第一个和弦用密集排列。和 Dm7 – G7 – CM7 等内置键位的推导方法相同（content.test.ts）。
 */
export function voiceLeadProgression(
  id: string,
  steps: readonly { chord: ChordEntry; voicing: Voicing | null }[],
): Voicing[] {
  const out: Voicing[] = [];
  let prev: Voicing | null = null;
  steps.forEach(({ chord, voicing }, i) => {
    let v = voicing;
    if (!v) {
      if (!prev) {
        v = { ...chord.reference, id: `${id}-${i + 1}`, status: 'generated' };
      } else {
        const prevRight = prev.notes.filter((n) => n.hand === 'right').map((n) => n.midi);
        const prevBass = Math.min(
          ...prev.notes.filter((n) => n.hand === 'left').map((n) => n.midi),
        );
        const ranked =
          rankRightHandVoicings(prevRight, chord.rootName, chord.quality)[0] ??
          rankRightHandVoicings(prevRight, chord.rootName, chord.quality, { size: 4 })[0];
        const right =
          ranked?.notes ??
          chord.reference.notes.filter((n) => n.hand === 'right').map((n) => n.midi);
        const tones = chord.tones;
        const nameOf = (midi: number) =>
          nameAt(tones.find((t) => nameToPitchClass(t) === midi % 12) ?? tones[0] ?? 'C', midi);
        const bassName = chord.bassName ?? chord.rootName;
        const bass = nearestBass(prevBass, bassName);
        v = {
          id: `${id}-${i + 1}`,
          chordId: chord.id,
          status: 'generated',
          notes: [
            { name: nameAt(bassName, bass), midi: bass, hand: 'left', finger: 5 },
            ...right.map((m): VoicedNote => ({ name: nameOf(m), midi: m, hand: 'right' })),
          ],
        };
      }
    }
    out.push(v);
    prev = v;
  });
  return out;
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
    const voiced = voiceLeadProgression(
      p.id,
      p.steps.map((s) => ({
        chord: chordById.get(s.chordId) as ChordEntry,
        voicing: s.voicingId === undefined ? null : (voicingById.get(s.voicingId) as Voicing),
      })),
    );
    const entry: ProgressionEntry = {
      id: p.id,
      name: p.name,
      key: p.key,
      steps: p.steps.map((s, i) => ({
        chord: chordById.get(s.chordId) as ChordEntry,
        voicing: voiced[i] as Voicing,
        beats: s.beats,
        anticipation: s.anticipation,
      })),
    };
    if (p.description) entry.description = p.description;
    return entry;
  });

  const progressionById = new Map(progressions.map((p) => [p.id, p]));
  const rhythms: RhythmEntry[] = data.rhythms.map((r) => ({
    id: r.id,
    time: [r.time[0], r.time[1]],
    bpm: r.bpm,
    notes: r.notes,
    pattern: parseRhythm(r.notes, r.time),
  }));
  // 听声音的卡片：作答时可以从这些和弦里选（多个主题用到同一张卡时合并）
  const choicesByCard = new Map<string, string[]>();
  const addChoices = (cardId: string, chordIds: readonly string[]) => {
    const list = choicesByCard.get(cardId) ?? [];
    for (const id of chordIds) if (!list.includes(id)) list.push(id);
    choicesByCard.set(cardId, list);
  };
  const topics: TopicEntry[] = data.topics.map((t) => {
    const pr = t.practice;
    let cards: AnyCard[];
    switch (pr.kind) {
      case 'notes':
        cards = pr.notes.map((n) => noteCard(n, t.id));
        break;
      case 'staffNotes':
        cards = pr.items.map((it) =>
          staffNoteCard(it.clef, it.pitch, { key: it.key ?? null, topicId: t.id }),
        );
        break;
      case 'rhythms':
        cards = pr.rhythms.map((id) => rhythmCard(id, t.id));
        break;
      case 'intervals':
        cards = pr.items.map((i) => intervalCard(i.root, i.interval, t.id));
        break;
      case 'chords': {
        const key = pr.cue === 'roman' || pr.cue === 'audio' ? (pr.key ?? null) : null;
        cards = [...new Set(pr.chords)].map((id) =>
          chordCard(id, { voicingMode: pr.voicingMode, topicId: t.id, cue: pr.cue, key }),
        );
        // 听辨：从这个主题的和弦里选
        if (pr.cue === 'audio') for (const c of cards) addChoices(c.id, pr.chords);
        break;
      }
      case 'contrast': {
        const seen = new Map<string, AnyCard>();
        for (const pair of pr.pairs) {
          for (const id of pair) {
            const card = chordCard(id, { cue: 'audio', topicId: t.id });
            if (!seen.has(card.id)) seen.set(card.id, card);
            addChoices(card.id, pair);
          }
        }
        cards = [...seen.values()];
        break;
      }
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
      rhythms,
      rhythmById: new Map(rhythms.map((r) => [r.id, r])),
      voicingNotes,
      topics,
      topicById: new Map(topics.map((t) => [t.id, t])),
      graph: buildTopicGraph(topics),
      cardById,
      topicsOfCard,
      choicesByCard,
    },
  };
}

/** 把校验问题格式化成便于阅读的中文文本（用于导入失败提示）。 */
export function formatIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.map((i) => `${i.path.length ? `${i.path.join('.')}：` : ''}${i.message}`);
}
