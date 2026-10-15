import type {
  CardProgress,
  FollowSummary,
  HandsMode,
  PlannedTask,
  ReviewLog,
  ScoreFileFormat,
  ScoreSource,
  SessionSummary,
} from '@mayochord/core';
import Dexie, { type Table } from 'dexie';

/**
 * 本地数据库（IndexedDB，通过 Dexie）。业务代码不要直接用它，而是通过 repositories.ts 里的接口。
 *
 * 版本规则：任何表结构（主键、索引）变化都新增一个 this.version(n)，保留旧版本声明，
 * 需要转换数据时写 .upgrade()，并在 db.test.ts 里加"旧版本数据升级后不丢失"的测试。
 */
export const DB_NAME = 'mayochord';

/** 作答日志的存储形式：自增 seq 作主键（保证追加顺序），id 唯一 */
export interface StoredReviewLog extends ReviewLog {
  seq?: number;
}

export interface SettingRecord {
  key: string;
  value: unknown;
  updatedAt: number;
}

/** 某个 MIDI 输入设备的校准数据，按端口名区分 */
export interface CalibrationRecord {
  deviceKey: string;
  /** 实测偏移：按下琴上的中央 C 收到的音符号 - 60。输入事件会减去它 */
  noteOffset: number;
  /** 实测的最低键、最高键（已扣除偏移） */
  lowestNote: number | null;
  highestNote: number | null;
  updatedAt: number;
}

/**
 * 卡片学习进度（FSRS 记忆状态 + 新卡阶段）：由 reviewLogs 重放得到的缓存，可以随时重建。
 * due 单独存一份用于索引（新卡没有到期时间，存 Number.MAX_SAFE_INTEGER）。
 */
export interface CardStateRecord {
  cardId: string;
  due: number;
  progress: CardProgress;
}

/** 一轮练习的记录 */
export interface SessionRecord {
  id: string;
  startedAt: number;
  endedAt: number | null;
  kind: 'practice';
  /** 练习配置，例如 { group, drill, mode, length } */
  config: Record<string, unknown>;
  summary: SessionSummary | null;
  /** 这一轮得到的 XP（M3 起） */
  xp?: number;
}

export type TaskStatus = 'pending' | 'done' | 'skipped';

export interface StoredTask extends PlannedTask {
  status: TaskStatus;
  completedAt: number | null;
  xp: number;
  /** 掌握检查 / 复习的结果摘要，例如 { passed: true, accuracy: 0.9 } */
  result: Record<string, unknown> | null;
}

/** 某一天的任务清单（第一次打开"今天"时生成，当天内保持不变，除非跳过或替换） */
export interface DailyPlanRecord {
  date: string;
  createdAt: number;
  tasks: StoredTask[];
  dueTopics: string[];
  spareLessons: string[];
}

/** 用户导入的内容包（原始 JSON，导入时已通过 Zod 校验） */
export interface UserPackRecord {
  id: string;
  version: string;
  importedAt: number;
  data: unknown;
}

/** 本地乐谱库里的一首曲子（M7）。只存在本地，不上传 */
export interface ScoreRecord {
  id: string;
  title: string;
  fileName: string;
  format: ScoreFileFormat;
  importedAt: number;
  /** 原文（MusicXML 文本或 MIDI 文件的 base64）；打开时重新解析 */
  source: ScoreSource;
  /** 列表显示用 */
  measureCount: number;
  noteCount: number;
  /** 上次练习的选项（由曲谱页面校验） */
  prefs: unknown;
  lastPlayedAt: number | null;
}

/** 一次曲谱跟弹的结果（M7） */
export interface ScoreRunRecord {
  id: string;
  scoreId: string;
  startedAt: number;
  endedAt: number;
  mode: 'wait' | 'tempo';
  hands: HandsMode;
  /** 练习的小节范围（下标，含两端） */
  from: number;
  to: number;
  /** 跟拍模式的速度 */
  bpm: number | null;
  summary: FollowSummary;
  xp: number;
}

export class MayoChordDB extends Dexie {
  declare reviewLogs: Table<StoredReviewLog, number>;
  declare settings: Table<SettingRecord, string>;
  declare calibrations: Table<CalibrationRecord, string>;
  declare cardStates: Table<CardStateRecord, string>;
  declare sessions: Table<SessionRecord, string>;
  declare userPacks: Table<UserPackRecord, string>;
  declare dailyPlans: Table<DailyPlanRecord, string>;
  declare scores: Table<ScoreRecord, string>;
  declare scoreRuns: Table<ScoreRunRecord, string>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      reviewLogs: '++seq, &id, ts, cardId, sessionId, [cardId+ts]',
      settings: 'key',
      calibrations: 'deviceKey',
      cardStates: 'cardId, due',
      sessions: 'id, startedAt',
      userPacks: 'id',
    });
    // v2（M3）：每日任务清单
    this.version(2).stores({ dailyPlans: 'date' });
    // v3（M7）：本地乐谱库与跟弹记录
    this.version(3).stores({ scores: 'id, importedAt', scoreRuns: 'id, scoreId, startedAt' });
  }
}
