import { MayoChordDB } from './db';
import { createDexieRepositories, type Repositories } from './repositories';

export type {
  CalibrationRecord,
  DailyPlanRecord,
  SessionRecord,
  StoredTask,
  TaskStatus,
} from './db';
export type * from './repositories';

let instance: { db: MayoChordDB; repos: Repositories } | null = null;

/** 应用使用的仓储（懒创建，避免在不需要数据库的测试里打开 IndexedDB）。 */
export function repositories(): Repositories {
  if (!instance) {
    const db = new MayoChordDB();
    instance = { db, repos: createDexieRepositories(db) };
  }
  return instance.repos;
}

/** 同 repositories()，但 IndexedDB 不可用时返回 null（用默认设置继续运行，只是不保存）。 */
export function tryRepositories(): Repositories | null {
  try {
    return repositories();
  } catch {
    return null;
  }
}
