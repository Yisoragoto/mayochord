import { fallbackStamp, type OutputStamp, perfToAudio } from '@mayochord/core';

type ToneModule = typeof import('tone');

let tone: Promise<ToneModule> | null = null;
let native: AudioContext | null = null;

/**
 * 加载 Tone.js（懒加载），让钢琴音源和节拍器共用同一个原生 AudioContext。
 * 必须在用户手势（点击、按键）里第一次调用，浏览器才允许启动音频。
 */
export function loadTone(): Promise<ToneModule> {
  tone ??= (async () => {
    const t = await import('tone');
    native = new AudioContext({ latencyHint: 'interactive' });
    t.setContext(new t.Context(native));
    await t.start();
    return t;
  })().catch((err: unknown) => {
    tone = null;
    native = null;
    throw err;
  });
  return tone;
}

/**
 * 音频时钟与 performance.now() 的对应关系（规格 4.3）。优先用 getOutputTimestamp
 * （已含输出延迟）；不支持时用 currentTime 加上 outputLatency + baseLatency 估计。
 */
export function outputStamp(ctx: AudioContext): OutputStamp {
  const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
  if (ts?.contextTime && ts.performanceTime) {
    return { contextTime: ts.contextTime, performanceTime: ts.performanceTime };
  }
  const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  return fallbackStamp(ctx.currentTime, performance.now(), latency);
}

/** performance.now() 域的时刻 → 在这个时刻出声要安排的 AudioContext 时间；音频还没启动时为 null */
export function perfToContextTime(perf: number): number | null {
  return native ? perfToAudio(perf, outputStamp(native)) : null;
}

export function nativeAudioContext(): AudioContext | null {
  return native;
}
