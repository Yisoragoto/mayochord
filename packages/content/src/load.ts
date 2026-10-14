import {
  type ChordQuality,
  type ChordSymbol,
  chordTones,
  type Finger,
  type Hand,
  nameToMidi,
  symbolFromNames,
  type VoicedNote,
  type Voicing,
} from '@mayochord/core';
import type { z } from 'zod';
import { type ContentPackData, ContentPackSchema, type I18nText } from './schema/pack';

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
  steps: { chord: ChordEntry; voicing: Voicing; beats: number }[];
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

  const chords: ChordEntry[] = data.chords.map((c) => {
    const voicings = data.voicings
      .filter((v) => v.chordId === c.id)
      .map((v) => voicingById.get(v.id) as Voicing);
    const refId = data.voicings.find((v) => v.chordId === c.id && v.reference)?.id as string;
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
      })),
    };
    if (p.description) entry.description = p.description;
    return entry;
  });

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
      progressionById: new Map(progressions.map((p) => [p.id, p])),
      voicingNotes,
    },
  };
}

/** 把校验问题格式化成便于阅读的中文文本（用于导入失败提示）。 */
export function formatIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.map((i) => `${i.path.length ? `${i.path.join('.')}：` : ''}${i.message}`);
}
