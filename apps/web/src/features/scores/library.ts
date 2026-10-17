import { EXAMPLE_SCORE_FILE_NAME, EXAMPLE_SCORE_XML } from '@mayochord/content';
import { importScoreFile, type Score, ScoreImportError, scoreEnd, TPQ } from '@mayochord/core';
import { z } from 'zod';
import type { Repositories, ScoreRecord } from '@/storage';

/** 曲谱页面的选项（每首曲子各存一份，在 ScoreRecord.prefs） */
export const ScorePrefsSchema = z
  .object({
    view: z.enum(['staff', 'waterfall']).catch('staff'),
    mode: z.enum(['wait', 'tempo', 'listen']).catch('wait'),
    hands: z.enum(['both', 'left', 'right']).catch('both'),
    otherHand: z.enum(['play', 'mute']).catch('play'),
    /** 小节下标（含两端）；to = null 表示到最后 */
    from: z.number().int().min(0).catch(0),
    to: z.number().int().min(0).nullable().catch(null),
    /** 相对谱上速度 */
    speed: z.number().min(0.25).max(1.5).catch(1),
    /** 0 = 一直循环 */
    loops: z.number().int().min(0).max(99).catch(1),
    metronome: z.boolean().catch(true),
    /** 按反复记号展开（M8） */
    repeats: z.boolean().catch(true),
    /** 显示自动标出的和弦（M8） */
    chords: z.boolean().catch(true),
    /** 键盘上标出要弹的音 */
    keyHints: z.boolean().catch(true),
    /** 原速（♩ =），null = 用谱上的速度 */
    baseBpm: z.number().int().min(20).max(300).nullable().catch(null),
  })
  .catch({
    view: 'staff',
    mode: 'wait',
    hands: 'both',
    otherHand: 'play',
    from: 0,
    to: null,
    speed: 1,
    loops: 1,
    metronome: true,
    repeats: true,
    chords: true,
    keyHints: true,
    baseBpm: null,
  });
export type ScorePrefs = z.infer<typeof ScorePrefsSchema>;

export function parsePrefs(raw: unknown): ScorePrefs {
  return ScorePrefsSchema.parse(raw ?? {});
}

/** 文件太大时不导入（钢琴谱一般几百 KB） */
export const MAX_SCORE_BYTES = 10 * 1024 * 1024;

export type ImportError = ScoreImportError['code'] | 'too-large' | 'save';

export type ImportResult = { ok: true; id: string } | { ok: false; error: ImportError };

function record(
  id: string,
  now: number,
  fileName: string,
  bytes: Uint8Array,
  title?: string,
): ScoreRecord {
  const { score, source, format } = importScoreFile(bytes, fileName);
  return {
    id,
    title: title ?? (score.title || fileName),
    fileName,
    format,
    importedAt: now,
    source,
    measureCount: score.measures.length,
    noteCount: score.notes.length,
    prefs: null,
    lastPlayedAt: null,
  };
}

/** 导入一个文件到本地乐谱库 */
export async function importScore(
  repos: Repositories,
  file: { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> },
  id: string,
  now: number,
): Promise<ImportResult> {
  if (file.size > MAX_SCORE_BYTES) return { ok: false, error: 'too-large' };
  let rec: ScoreRecord;
  try {
    rec = record(id, now, file.name, new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    return { ok: false, error: err instanceof ScoreImportError ? err.code : 'xml' };
  }
  try {
    await repos.scores.put(rec);
  } catch {
    return { ok: false, error: 'save' };
  }
  return { ok: true, id };
}

/** 添加内置的示例曲谱（欢乐颂） */
export async function addExampleScore(
  repos: Repositories,
  id: string,
  now: number,
  title: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(EXAMPLE_SCORE_XML);
  await repos.scores.put(record(id, now, EXAMPLE_SCORE_FILE_NAME, bytes, title));
  return id;
}

/** 按谱上速度弹完整首的秒数 */
export function scoreSeconds(score: Score): number {
  return (scoreEnd(score) / TPQ) * (60 / score.tempo);
}
