import type { ReviewLog } from '@mayochord/core';
import { z } from 'zod';
import type { MayoChordDB } from './db';

/**
 * 备份与迁移（规格 12）：导出全部数据为 JSON，作答日志另可导出 CSV；导入 JSON 会替换现有数据。
 * 格式：{ kind: 'mayochord-backup', formatVersion: 1, exportedAt, dbVersion, tables: { 表名: 行[] } }。
 * 卡片状态（cardStates）是作答日志的缓存，也一并导出（导入后不用重放）。
 */
export const BACKUP_KIND = 'mayochord-backup';
export const BACKUP_FORMAT_VERSION = 1;

const TABLES = [
  'reviewLogs',
  'settings',
  'calibrations',
  'cardStates',
  'sessions',
  'dailyPlans',
  'userPacks',
  'scores',
  'scoreRuns',
] as const;
export type BackupTable = (typeof TABLES)[number];

const rows = z.array(z.record(z.string(), z.unknown()));
export const BackupSchema = z.object({
  kind: z.literal(BACKUP_KIND),
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  exportedAt: z.number(),
  dbVersion: z.number().int().positive(),
  appVersion: z.string().optional(),
  tables: z.object({
    // 作答日志：至少要有 id、ts、cardId，其他字段原样保存
    reviewLogs: z.array(z.looseObject({ id: z.string(), ts: z.number(), cardId: z.string() })),
    settings: rows.default([]),
    calibrations: rows.default([]),
    cardStates: rows.default([]),
    sessions: rows.default([]),
    dailyPlans: rows.default([]),
    userPacks: rows.default([]),
    // M7（数据库 v3）新增；旧备份没有这两项
    scores: rows.default([]),
    scoreRuns: rows.default([]),
  }),
});
export type Backup = z.infer<typeof BackupSchema>;

export async function exportBackup(
  db: MayoChordDB,
  now: number,
  appVersion?: string,
): Promise<Backup> {
  const [
    reviewLogs,
    settings,
    calibrations,
    cardStates,
    sessions,
    dailyPlans,
    userPacks,
    scores,
    scoreRuns,
  ] = await Promise.all([
    db.reviewLogs.orderBy('seq').toArray(),
    db.settings.toArray(),
    db.calibrations.toArray(),
    db.cardStates.toArray(),
    db.sessions.toArray(),
    db.dailyPlans.toArray(),
    db.userPacks.toArray(),
    db.scores.toArray(),
    db.scoreRuns.toArray(),
  ]);
  return {
    kind: BACKUP_KIND,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: now,
    dbVersion: db.verno,
    ...(appVersion ? { appVersion } : {}),
    tables: {
      // seq 是本地自增编号，导入时重新生成（保持顺序）
      reviewLogs: reviewLogs.map(({ seq: _seq, ...log }) => log),
      settings: settings as never,
      calibrations: calibrations as never,
      cardStates: cardStates as never,
      sessions: sessions as never,
      dailyPlans: dailyPlans as never,
      userPacks: userPacks as never,
      scores: scores as never,
      scoreRuns: scoreRuns as never,
    },
  };
}

/** json = 不是 JSON；kind = 不是 MayoChord 的备份；format = 格式不对 */
export type BackupError = 'json' | 'kind' | 'format';
export type ParsedBackup = { ok: true; backup: Backup } | { ok: false; error: BackupError };

export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'json' };
  }
  const parsed = BackupSchema.safeParse(raw);
  if (!parsed.success) {
    const kind = (raw as { kind?: unknown } | null)?.kind;
    return { ok: false, error: kind === BACKUP_KIND ? 'format' : 'kind' };
  }
  return { ok: true, backup: parsed.data };
}

/** 用备份替换现有的全部数据（一个事务：失败时不改动） */
export async function importBackup(db: MayoChordDB, backup: Backup): Promise<void> {
  const t = backup.tables;
  await db.transaction(
    'rw',
    [
      db.reviewLogs,
      db.settings,
      db.calibrations,
      db.cardStates,
      db.sessions,
      db.dailyPlans,
      db.userPacks,
      db.scores,
      db.scoreRuns,
    ],
    async () => {
      await Promise.all(TABLES.map((name) => db.table(name).clear()));
      const logs = [...t.reviewLogs].sort((a, b) => a.ts - b.ts);
      await db.reviewLogs.bulkAdd(logs as never[]);
      await db.settings.bulkPut(t.settings as never[]);
      await db.calibrations.bulkPut(t.calibrations as never[]);
      await db.cardStates.bulkPut(t.cardStates as never[]);
      await db.sessions.bulkPut(t.sessions as never[]);
      await db.dailyPlans.bulkPut(t.dailyPlans as never[]);
      await db.userPacks.bulkPut(t.userPacks as never[]);
      await db.scores.bulkPut(t.scores as never[]);
      await db.scoreRuns.bulkPut(t.scoreRuns as never[]);
    },
  );
}

const CSV_COLUMNS = [
  'id',
  'ts',
  'time',
  'sessionId',
  'cardId',
  'cardKind',
  'drillType',
  'evidence',
  'weight',
  'correct',
  'reactionMs',
  'extraNotes',
  'missingNotes',
  'spreadMs',
  'beatOffsetMs',
  'hintUsed',
  'rating',
  'inputSource',
  'xp',
  'mashing',
  'contentVersion',
] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join(' ') : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 作答日志 → CSV（UTF-8，第一行是列名；time 是 ISO 时间，方便表格软件阅读） */
export function logsToCsv(logs: readonly ReviewLog[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const l of logs) {
    const row = CSV_COLUMNS.map((c) =>
      c === 'time'
        ? new Date(l.ts).toISOString()
        : csvCell((l as unknown as Record<string, unknown>)[c]),
    );
    lines.push(row.join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
