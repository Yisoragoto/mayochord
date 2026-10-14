import {
  CHORD_QUALITIES,
  type ChordQuality,
  chordQualityDef,
  chordSlug,
  chordTones,
  nameToMidi,
  parseNoteName,
  validateTopicGraph,
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
  /** 先行切分：提前几个 16 分音符换到这个和弦（0–3，跟拍练习用） */
  anticipation: z.number().int().min(0).max(3).default(0),
});

export const ProgressionSchema = z.object({
  id: ID,
  name: I18nTextSchema,
  /** 大调主音 */
  key: PitchName,
  steps: z.array(ProgressionStepSchema).min(1),
  description: I18nTextSchema.optional(),
});

/** 课程讲解里的一步：文字 + 可选的键盘示范 */
export const ExplainStepSchema = z.object({
  text: I18nTextSchema,
  demo: z
    .object({
      /** 在键盘上标出的音（带八度） */
      notes: z.array(NoteName).min(1).optional(),
      /** 或者直接示范一个和弦的参考键位 */
      chord: ID.optional(),
      /** 键上的数字：semitones = 从第一个音数半音（0、1、2…）；fingers = 指法 */
      labels: z.enum(['semitones', 'fingers', 'none']).default('fingers'),
      /** 播放方式 */
      play: z.enum(['together', 'arpeggio', 'none']).default('together'),
    })
    .optional(),
});

const IntervalNameSchema = z.enum(['m2', 'M2', 'm3', 'M3', 'P4', 'P5']);

/** 主题的练习内容：生成哪些卡片 */
export const TopicPracticeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('notes'), notes: z.array(PitchName).min(1) }),
  z.object({
    kind: z.literal('intervals'),
    items: z.array(z.object({ root: PitchName, interval: IntervalNameSchema })).min(1),
  }),
  z.object({
    kind: z.literal('chords'),
    chords: z.array(ID).min(1),
    voicingMode: z.enum(['any', 'reference']).default('any'),
  }),
  z.object({
    kind: z.literal('transitions'),
    /** 用这些进行里相邻和弦的切换（循环） */
    progressions: z.array(ID).min(1),
    voicingMode: z.enum(['any', 'reference']).default('any'),
  }),
  /**
   * 跟拍弹一条进行（M4）。课程各阶段都是跟拍练习：引导（放慢、显示键位）→ 独立（隐藏键位，
   * 干净地弹对 independent.requiredCorrect 个和弦）→ 掌握检查（mastery.questions 个和弦，
   * 没有漏弹且干净的比例 ≥ mastery.minAccuracy，规格第 11 节）。每日复习用这条进行的切换卡。
   */
  z.object({
    kind: z.literal('progression'),
    progression: ID,
    /** 目标速度 */
    bpm: z.number().int().min(40).max(200),
    /** 每个和弦几拍；省略 = 按进行自带的拍数 */
    beatsPerChord: z.number().int().min(1).max(8).optional(),
    voicingMode: z.enum(['any', 'reference']).default('any'),
  }),
]);

/** 课程结构（规格 6.2）：讲解示范 → 引导练习 → 独立练习 → 掌握检查 */
export const LessonSchema = z.object({
  explain: z.array(ExplainStepSchema).min(1),
  /** 引导练习：显示键位，每张卡弹一次（最多 count 张） */
  guided: z.object({ count: z.number().int().min(1).default(6) }).default({ count: 6 }),
  /** 独立练习：不显示提示，弹对 requiredCorrect 次 */
  independent: z
    .object({ requiredCorrect: z.number().int().min(1).default(8) })
    .default({ requiredCorrect: 8 }),
  /** 掌握检查：限时、无提示 */
  mastery: z
    .object({
      questions: z.number().int().min(1).default(8),
      minAccuracy: z.number().min(0).max(1).default(0.85),
      timeLimitMs: z.number().int().min(1000).default(6000),
    })
    .default({ questions: 8, minAccuracy: 0.85, timeLimitMs: 6000 }),
  /** 预计时长（分钟），每日任务编排用 */
  minutes: z.number().positive().default(8),
});

export const TopicSchema = z.object({
  id: ID,
  title: I18nTextSchema,
  summary: I18nTextSchema,
  prerequisites: z.array(ID).default([]),
  /** 包含关系与权重（隐式重复）。默认不设 = 0，只给确实相关的关系设置 */
  encompasses: z.array(z.object({ topicId: ID, weight: z.number().min(0).max(1) })).default([]),
  /** 同组的新主题不在同一天引入（例如 M7 与 7） */
  interferenceGroup: z.string().optional(),
  practice: TopicPracticeSchema,
  lesson: LessonSchema,
});

const ContentPackBase = z.object({
  id: ID,
  version: z.string().regex(/^\d+\.\d+\.\d+$/, '版本号应为 semver，例如 1.0.0'),
  schemaVersion: z.literal(CONTENT_SCHEMA_VERSION),
  name: I18nTextSchema,
  chords: z.array(ChordSchema),
  voicings: z.array(VoicingSchema),
  progressions: z.array(ProgressionSchema),
  /** 知识图谱的主题节点（M3 起） */
  topics: z.array(TopicSchema).default([]),
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

  // 没有给键位的和弦由 closeVoicing 自动生成参考键位；给了键位的必须恰好一个参考键位
  for (const c of pack.chords) {
    const own = pack.voicings.filter((v) => v.chordId === c.id);
    const refs = own.filter((v) => v.reference);
    if (own.length > 0 && refs.length !== 1)
      issue(['voicings'], `和弦 ${c.id} 应恰好有一个参考键位，现有 ${refs.length} 个`);
  }

  const progressionIds = new Set(pack.progressions.map((p) => p.id));
  for (const id of duplicates(pack.topics.map((t) => t.id))) issue(['topics'], `重复的 ID：${id}`);
  const nodes = pack.topics.map((t) => ({
    id: t.id,
    prerequisites: t.prerequisites,
    encompasses: t.encompasses,
  }));
  for (const msg of validateTopicGraph(nodes)) issue(['topics'], msg);
  pack.topics.forEach((t, i) => {
    const pr = t.practice;
    if (pr.kind === 'chords') {
      pr.chords.forEach((id, j) => {
        if (!chords.has(id)) issue(['topics', i, 'practice', 'chords', j], `不存在的和弦：${id}`);
      });
    }
    if (pr.kind === 'progression' && !progressionIds.has(pr.progression)) {
      issue(['topics', i, 'practice', 'progression'], `不存在的进行：${pr.progression}`);
    }
    if (pr.kind === 'transitions') {
      pr.progressions.forEach((id, j) => {
        if (!progressionIds.has(id)) {
          issue(['topics', i, 'practice', 'progressions', j], `不存在的进行：${id}`);
        }
      });
    }
    t.lesson.explain.forEach((step, j) => {
      const chord = step.demo?.chord;
      if (chord !== undefined && !chords.has(chord)) {
        issue(['topics', i, 'lesson', 'explain', j, 'demo', 'chord'], `不存在的和弦：${chord}`);
      }
    });
  });

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
export type TopicData = z.infer<typeof TopicSchema>;
export type LessonData = z.infer<typeof LessonSchema>;
export type ExplainStep = z.infer<typeof ExplainStepSchema>;
export type TopicPractice = z.infer<typeof TopicPracticeSchema>;
