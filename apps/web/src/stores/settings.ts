import { DEFAULT_ATTEMPT_OPTIONS } from '@mayochord/core';
import { z } from 'zod';
import { create } from 'zustand';
import type { SettingsRepository } from '@/storage';

/**
 * 应用设置（保存在 IndexedDB 的 settings 表，键 'app'）。
 * 每个字段都有 .catch(默认值)：存储的数据缺字段或损坏时，只回退那一项。
 */
export const SettingsSchema = z.object({
  /** 踩踏板时松开的音是否仍算“按住” */
  sustainCountsAsHeld: z.boolean().catch(DEFAULT_ATTEMPT_OPTIONS.sustainCountsAsHeld),
  /** 和弦判定：所有音需在多少毫秒内按下 */
  onsetWindowMs: z.number().int().min(20).max(300).catch(DEFAULT_ATTEMPT_OPTIONS.onsetWindowMs),
  /** 和弦判定：保持多少毫秒不变才算弹出 */
  stableMs: z.number().int().min(50).max(600).catch(DEFAULT_ATTEMPT_OPTIONS.stableMs),
  /** 允许用电脑键盘弹奏 */
  computerKeyboard: z.boolean().catch(true),
  /** 屏幕键盘：按住发声（momentary），或点击切换按下/抬起（latch，方便用鼠标按和弦） */
  onscreenMode: z.enum(['momentary', 'latch']).catch('momentary'),
  /** 屏幕键盘、电脑键盘弹奏时由网页发声（MIDI 键盘有自己的声音，不受影响） */
  onscreenSound: z.boolean().catch(true),
  /** 练习时答对、答错的提示音 */
  feedbackSound: z.boolean().catch(false),
  /** 每天的练习时长目标（分钟），每日任务按它编排 */
  dailyMinutes: z.number().int().min(5).max(180).catch(30),
  /** 每日 XP 目标 */
  dailyXpGoal: z.number().int().min(1).max(200).catch(20),
  /** 每天最多开始几节新课 */
  newTopicsPerDay: z.number().int().min(0).max(5).catch(2),
  /** 开发用：模拟时间前进的天数（只在开发服务器里生效） */
  devClockOffsetDays: z.number().int().min(0).max(3650).catch(0),
  /** 上次手动选择的 MIDI 输入设备名 */
  preferredInputName: z.string().nullable().catch(null),
});

export type AppSettings = z.infer<typeof SettingsSchema>;
export const DEFAULT_SETTINGS: AppSettings = SettingsSchema.parse({});
const SETTINGS_KEY = 'app';

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  update: (patch: Partial<AppSettings>) => void;
}

let repo: SettingsRepository | null = null;

export const useSettings = create<SettingsState>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  update: (patch) => {
    const settings = SettingsSchema.parse({ ...get().settings, ...patch });
    set({ settings });
    void repo?.set(SETTINGS_KEY, settings);
  },
}));

export function parseStoredSettings(raw: unknown): AppSettings {
  return SettingsSchema.parse(raw !== null && typeof raw === 'object' ? raw : {});
}

/** 启动时从仓储读取设置。之后 update() 会写回同一个仓储。 */
export async function loadSettings(settingsRepo: SettingsRepository): Promise<void> {
  repo = settingsRepo;
  const raw = await settingsRepo.get(SETTINGS_KEY);
  useSettings.setState({ settings: parseStoredSettings(raw), loaded: true });
}
