import type { ReviewLog } from '@mayochord/core';
import Dexie from 'dexie';
import type { CalibrationRecord, MayoChordDB } from './db';

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
  count(): Promise<number>;
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
  };
}
