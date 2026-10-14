/**
 * 音频时钟 ↔ 输入时钟（规格 4.3）。
 * 输入事件在 performance.now() 域（毫秒），节拍器在 AudioContext 时钟（秒）。
 * AudioContext.getOutputTimestamp() 给出一对同时刻的读数：contextTime 秒的采样正在 performanceTime 毫秒从扬声器输出。
 */
export interface OutputStamp {
  /** AudioContext 时钟（秒） */
  contextTime: number;
  /** 同一时刻的 performance.now()（毫秒） */
  performanceTime: number;
}

/** 音频时刻（秒）→ 这个声音实际发出的 performance.now() 时刻（毫秒） */
export function audioToPerf(audioTime: number, stamp: OutputStamp): number {
  return stamp.performanceTime + (audioTime - stamp.contextTime) * 1000;
}

/** performance.now() 时刻（毫秒）→ 音频时刻（秒） */
export function perfToAudio(perf: number, stamp: OutputStamp): number {
  return stamp.contextTime + (perf - stamp.performanceTime) / 1000;
}

/**
 * 浏览器不支持 getOutputTimestamp（或返回 0）时的估计：
 * 以 currentTime 与 performance.now() 为同一时刻，再加上输出延迟（outputLatency + baseLatency，秒）。
 */
export function fallbackStamp(
  currentTime: number,
  perfNow: number,
  outputLatencySec: number,
): OutputStamp {
  return { contextTime: currentTime, performanceTime: perfNow + outputLatencySec * 1000 };
}
