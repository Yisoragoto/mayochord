import {
  CHORD_QUALITIES,
  type ChordQuality,
  chordQualityDef,
  chordSlug,
  chordTones,
  nameToMidi,
  parseNoteName,
} from '@mayochord/core';
import { z } from 'zod';

/** 内容包格式版本。字段有不兼容变化时递增，并在 loadContentPack 里写迁移。 */
export const CONTENT_SCHEMA_VERSION = 1;

const ID = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, '只能包含小写字母、数字和连字符');
/** 不带八度的音名（ASCII）：'C'、'Bb'、'F#' */
const PitchName = z.string().regex(/^[A-G](?:#{1,2}|b{1,2})?$/, "音名应形如 'C'、'Bb'、'F#'");
/** 带八度的音名（ASCII）：'C4'、'Bb3'、'G#4' */
const NoteName = z.string().regex(/^[A-G](?:#{1,2}|b{1,2})?-?\d$/, "音名应形如 'C4'、'Bb3'");

export const I18nTextSchema = z.object({
  'zh-CN': z.string().min(1),
  en: z.string().min(1).optional(),
  ja: z.string().min(1).optional(),
});

const QUALITY_IDS = CHORD_QUALITIES.map((q) => q.quality) as [ChordQuality, ...ChordQuality[]];

export const ChordSchema = z.object({
  /** 由根音、性质、低音推出的 URL 安全 ID，例如 'gm7'、'fmaj7'、'c7-9' */
  id: ID,
  root: PitchName,
  quality: z.enum(QUALITY_IDS),
  bass: PitchName.optional(),
});

export const VoicedNoteSchema = z.object({
  pitch: NoteName,
  hand: z.enum(['left', 'right']),
  finger: z.number().int().min(1).max(5).optional(),
});

export const VoicingSchema = z.object({
  id: ID,
  chordId: ID,
  /** 参考键位：严格模式判定、键盘图、示范播放都用它。每个和弦恰好一个 */
  reference: z.boolean(),
  /** tentative = 按规则设计、尚待确认 */
  status: z.enum(['confirmed', 'tentative']),
  notes: z.array(VoicedNoteSchema).min(1),
  note: I18nTextSchema.optional(),
});

export const ProgressionStepSchema = z.object({
  chordId: ID,
  voicingId: ID,
  beats: z.number().positive(),
});

export const ProgressionSchema = z.object({
  id: ID,
  name: I18nTextSchema,
  /** 大调主音 */
  key: PitchName,
  steps: z.array(ProgressionStepSchema).min(1),
  description: I18nTextSchema.optional(),
});

const ContentPackBase = z.object({
  id: ID,
  version: z.string().regex(/^\d+\.\d+\.\d+$/, '版本号应为 semver，例如 1.0.0'),
  schemaVersion: z.literal(CONTENT_SCHEMA_VERSION),
  name: I18nTextSchema,
  chords: z.array(ChordSchema),
  voicings: z.array(VoicingSchema),
  progressions: z.array(ProgressionSchema),
});

type PackInput = z.infer<typeof ContentPackBase>;

/** 基础字段校验失败时 Zod 仍可能执行这里，保护一下会抛错的计算 */
function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null;
  }
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

/** 跨字段校验：ID 唯一、引用存在、键位的音都是和弦音且拼写正确、每个和弦恰好一个参考键位。 */
function crossCheck(pack: PackInput, ctx: z.RefinementCtx) {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: 'custom', path, message });

  for (const [key, list] of [
    ['chords', pack.chords],
    ['voicings', pack.voicings],
    ['progressions', pack.progressions],
  ] as const) {
    for (const id of duplicates(list.map((x) => x.id))) issue([key], `重复的 ID：${id}`);
  }

  const chords = new Map(pack.chords.map((c) => [c.id, c]));
  pack.chords.forEach((c, i) => {
    const expected = safe(() => chordSlug(c.root, c.quality, c.bass));
    if (expected !== null && c.id !== expected) {
      issue(['chords', i, 'id'], `和弦 ID 应为 '${expected}'`);
    }
  });

  const voicings = new Map(pack.voicings.map((v) => [v.id, v]));
  pack.voicings.forEach((v, i) => {
    const chord = chords.get(v.chordId);
    if (!chord) {
      issue(['voicings', i, 'chordId'], `不存在的和弦：${v.chordId}`);
      return;
    }
    const tones = safe(() => chordTones(chord.root, chord.quality));
    if (tones === null) return;
    const def = chordQualityDef(chord.quality);
    const used = new Set<string>();
    v.notes.forEach((n, j) => {
      const parsed = parseNoteName(n.pitch);
      const pcName = parsed ? n.pitch.replace(/-?\d+$/, '') : n.pitch;
      if (!tones.includes(pcName)) {
        issue(
          ['voicings', i, 'notes', j, 'pitch'],
          `${n.pitch} 不是 ${chord.id} 的和弦音（组成音：${tones.join(' ')}，注意升降号拼写）`,
        );
      }
      used.add(pcName);
      if (nameToMidi(n.pitch) === null) issue(['voicings', i, 'notes', j, 'pitch'], '无效音名');
    });
    def.tones.forEach((t, k) => {
      const name = tones[k] as string;
      if (used.has(name)) return;
      const omittable = t.degree === 5 && def.omit5Allowed;
      if (!omittable) issue(['voicings', i, 'notes'], `缺少和弦音 ${name}（${t.degree} 度）`);
    });
  });

  for (const c of pack.chords) {
    const refs = pack.voicings.filter((v) => v.chordId === c.id && v.reference);
    if (refs.length !== 1)
      issue(['voicings'], `和弦 ${c.id} 应恰好有一个参考键位，现有 ${refs.length} 个`);
  }

  pack.progressions.forEach((p, i) => {
    p.steps.forEach((s, j) => {
      if (!chords.has(s.chordId)) {
        issue(['progressions', i, 'steps', j, 'chordId'], `不存在的和弦：${s.chordId}`);
      }
      const v = voicings.get(s.voicingId);
      if (!v) issue(['progressions', i, 'steps', j, 'voicingId'], `不存在的键位：${s.voicingId}`);
      else if (v.chordId !== s.chordId) {
        issue(
          ['progressions', i, 'steps', j, 'voicingId'],
          `键位 ${s.voicingId} 不属于 ${s.chordId}`,
        );
      }
    });
  });
}

export const ContentPackSchema = ContentPackBase.superRefine(crossCheck);
export type ContentPackData = z.infer<typeof ContentPackSchema>;
export type I18nText = z.infer<typeof I18nTextSchema>;
