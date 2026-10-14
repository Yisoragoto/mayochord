import type { CardProgress, ReviewLog } from '@mayochord/core';
import Dexie from 'dexie';
import type { CalibrationRecord, MayoChordDB, SessionRecord } from './db';

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
}

export interface SettingsRepository {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface CalibrationRepository {
  get(deviceKey: string): Promise<CalibrationRecord | undefined>;
  put(record: CalibrationRecord): Promise<void>;
}

export interface Repositories {
  reviewLogs: ReviewLogRepository;
  settings: SettingsRepository;
  calibrations: CalibrationRepository;
  cardStates: CardStateRepository;
  sessions: SessionRepository;
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
    },
  };
}
