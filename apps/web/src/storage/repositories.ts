import type { CardProgress, ReviewLog } from '@mayochord/core';
import Dexie from 'dexie';
import { type Backup, exportBackup, importBackup } from './backup';
import type {
  CalibrationRecord,
  DailyPlanRecord,
  MayoChordDB,
  ScoreRecord,
  ScoreRunRecord,
  SessionRecord,
} from './db';

/**
 * 仓储接口（扩展点 4.2-6）。业务代码只依赖这些接口；现在的实现是 Dexie，
 * 以后可以加云同步实现而不改业务代码。
 */
export interface ReviewLogRepository {
  /** 追加一条日志。日志只追加，不提供修改和删除。ID 重复时抛错 */
  append(log: ReviewLog): Promise<void>;
  appendMany(logs: readonly ReviewLog[]): Promise<void>;
  /** 某张卡片的全部日志，按时间升序 */
  byCard(cardId: string): Promise<ReviewLog[]>;
  /** ts >= since 的日志，按追加顺序 */
  since(ts: number): Promise<ReviewLog[]>;
  /** 最近 limit 条日志，按追加顺序（旧 → 新） */
  latest(limit: number): Promise<ReviewLog[]>;
  /** 卡片 ID 以 prefix 开头的全部日志，按追加顺序（例如主题日志 'topic:'） */
  byCardPrefix(prefix: string): Promise<ReviewLog[]>;
  count(): Promise<number>;
}

/** 卡片进度缓存（可由日志重建） */
export interface CardStateRepository {
  getMany(cardIds: readonly string[]): Promise<Map<string, CardProgress>>;
  put(progress: CardProgress): Promise<void>;
  all(): Promise<CardProgress[]>;
}

export interface SessionRepository {
  put(session: SessionRecord): Promise<void>;
  /** 最近的 limit 轮练习，新的在前 */
  recent(limit: number): Promise<SessionRecord[]>;
  /** startedAt >= since 的练习，旧的在前 */
  since(since: number): Promise<SessionRecord[]>;
}

export interface DailyPlanRepository {
  get(date: string): Promise<DailyPlanRecord | undefined>;
  put(plan: DailyPlanRecord): Promise<void>;
}

export interface SettingsRepository {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface CalibrationRepository {
  get(deviceKey: string): Promise<CalibrationRecord | undefined>;
  put(record: CalibrationRecord): Promise<void>;
}

/** 备份与迁移（规格 12） */
export interface BackupRepository {
  /** 全部数据 */
  export(now: number, appVersion?: string): Promise<Backup>;
  /** 用备份替换全部数据 */
  import(backup: Backup): Promise<void>;
  /** 全部作答日志（导出 CSV、统计用），按追加顺序 */
  allLogs(): Promise<ReviewLog[]>;
}

/** 本地乐谱库（M7） */
export interface ScoreRepository {
  /** 全部曲谱，最近练习/导入的在前 */
  list(): Promise<ScoreRecord[]>;
  get(id: string): Promise<ScoreRecord | undefined>;
  put(record: ScoreRecord): Promise<void>;
  update(
    id: string,
    patch: Partial<Pick<ScoreRecord, 'title' | 'prefs' | 'lastPlayedAt'>>,
  ): Promise<void>;
  /** 删除曲谱和它的跟弹记录 */
  delete(id: string): Promise<void>;
  addRun(run: ScoreRunRecord): Promise<void>;
  /** 某首曲子的跟弹记录，旧的在前 */
  runs(scoreId: string): Promise<ScoreRunRecord[]>;
}

export interface Repositories {
  reviewLogs: ReviewLogRepository;
  backup: BackupRepository;
  settings: SettingsRepository;
  calibrations: CalibrationRepository;
  cardStates: CardStateRepository;
  sessions: SessionRepository;
  dailyPlans: DailyPlanRepository;
  scores: ScoreRepository;
}

const stripSeq = ({ seq: _seq, ...log }: ReviewLog & { seq?: number }): ReviewLog => log;

export function createDexieRepositories(db: MayoChordDB): Repositories {
  return {
    reviewLogs: {
      async append(log) {
        await db.reviewLogs.add({ ...log });
      },
      async appendMany(logs) {
        await db.reviewLogs.bulkAdd(logs.map((l) => ({ ...l })));
      },
      async byCard(cardId) {
        const rows = await db.reviewLogs
          .where('[cardId+ts]')
          .between([cardId, Dexie.minKey], [cardId, Dexie.maxKey])
          .toArray();
        return rows.map(stripSeq);
      },
      async since(ts) {
        const rows = await db.reviewLogs.where('ts').aboveOrEqual(ts).sortBy('seq');
        return rows.map(stripSeq);
      },
      async latest(limit) {
        const rows = await db.reviewLogs.orderBy('seq').reverse().limit(limit).toArray();
        return rows.reverse().map(stripSeq);
      },
      async byCardPrefix(prefix) {
        const rows = await db.reviewLogs.where('cardId').startsWith(prefix).sortBy('seq');
        return rows.map(stripSeq);
      },
      count: () => db.reviewLogs.count(),
    },
    settings: {
      async get(key) {
        return (await db.settings.get(key))?.value;
      },
      async set(key, value) {
        await db.settings.put({ key, value, updatedAt: Date.now() });
      },
    },
    calibrations: {
      get: (deviceKey) => db.calibrations.get(deviceKey),
      async put(record) {
        await db.calibrations.put(record);
      },
    },
    cardStates: {
      async getMany(cardIds) {
        const rows = await db.cardStates.bulkGet([...cardIds]);
        const out = new Map<string, CardProgress>();
        for (const r of rows) if (r) out.set(r.cardId, r.progress);
        return out;
      },
      async put(progress) {
        await db.cardStates.put({
          cardId: progress.cardId,
          due: progress.memory?.due ?? Number.MAX_SAFE_INTEGER,
          progress,
        });
      },
      async all() {
        return (await db.cardStates.toArray()).map((r) => r.progress);
      },
    },
    sessions: {
      async put(session) {
        await db.sessions.put(session);
      },
      recent: (limit) => db.sessions.orderBy('startedAt').reverse().limit(limit).toArray(),
      since: (since) => db.sessions.where('startedAt').aboveOrEqual(since).sortBy('startedAt'),
    },
    dailyPlans: {
      get: (date) => db.dailyPlans.get(date),
      async put(plan) {
        await db.dailyPlans.put(plan);
      },
    },
    scores: {
      async list() {
        const rows = await db.scores.toArray();
        const recent = (r: ScoreRecord) => Math.max(r.importedAt, r.lastPlayedAt ?? 0);
        return rows.sort((a, b) => recent(b) - recent(a));
      },
      get: (id) => db.scores.get(id),
      async put(record) {
        await db.scores.put(record);
      },
      async update(id, patch) {
        await db.scores.update(id, patch);
      },
      async delete(id) {
        await db.transaction('rw', [db.scores, db.scoreRuns], async () => {
          await db.scoreRuns.where('scoreId').equals(id).delete();
          await db.scores.delete(id);
        });
      },
      async addRun(run) {
        await db.scoreRuns.put(run);
      },
      runs: (scoreId) => db.scoreRuns.where('scoreId').equals(scoreId).sortBy('startedAt'),
    },
    backup: {
      export: (now, appVersion) => exportBackup(db, now, appVersion),
      import: (backup) => importBackup(db, backup),
      allLogs: async () => (await db.reviewLogs.orderBy('seq').toArray()).map(stripSeq),
    },
  };
}
