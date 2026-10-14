import type { DayParams } from '@mayochord/core';

/**
 * 应用的"墙上时钟"。开发时可以在设置里"模拟时间前进"几天，用来检查复习安排；
 * 只在开发服务器（import.meta.env.DEV）里生效，正式版本永远是真实时间。
 */
let offsetDays = 0;

export function setClockOffsetDays(days: number) {
  offsetDays = import.meta.env.DEV ? days : 0;
}

export function clockOffsetDays(): number {
  return offsetDays;
}

export function wallNow(): number {
  return Date.now() + offsetDays * 86_400_000;
}

/** 练习日参数：凌晨 4 点换日，本地时区 */
export function dayParams(): DayParams {
  return { dayStartHour: 4, tzOffsetMinutes: new Date(wallNow()).getTimezoneOffset() };
}
