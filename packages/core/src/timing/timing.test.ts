import { describe, expect, it } from 'vitest';
import {
  audioToPerf,
  beatGrid,
  beatPhase,
  beatTime,
  bpmToBeatMs,
  clickFor,
  estimateLatency,
  fallbackStamp,
  histogram,
  mean,
  nearestBeat,
  onBeatToleranceMs,
  perfToAudio,
  stdev,
} from './index';

describe('时钟换算', () => {
  it('音频时刻 ↔ performance.now()', () => {
    const stamp = { contextTime: 10, performanceTime: 5000 };
    expect(audioToPerf(10.5, stamp)).toBe(5500);
    expect(perfToAudio(5500, stamp)).toBeCloseTo(10.5);
    expect(fallbackStamp(2, 1000, 0.03)).toEqual({ contextTime: 2, performanceTime: 1030 });
  });
});

describe('节拍网格', () => {
  const grid = beatGrid(1000, 120, 4); // 每拍 500 ms

  it('拍点、最近的拍、相位', () => {
    expect(bpmToBeatMs(120)).toBe(500);
    expect(beatTime(grid, 3.75)).toBe(2875);
    expect(nearestBeat(grid, 1540)).toEqual({ beat: 1, offsetMs: 40 });
    expect(nearestBeat(grid, 1960)).toEqual({ beat: 2, offsetMs: -40 });
    expect(beatPhase(grid, 3250)).toEqual({ beat: 4, frac: 0.5, inBar: 0 });
    expect(beatPhase(grid, 500).inBar).toBe(3); // 预备拍（负数拍）
  });

  it('在拍上的容差：16 分音符的 45%，40–100 ms', () => {
    expect(onBeatToleranceMs(bpmToBeatMs(72))).toBeCloseTo(93.75);
    expect(onBeatToleranceMs(bpmToBeatMs(100))).toBeCloseTo(67.5);
    expect(onBeatToleranceMs(bpmToBeatMs(40))).toBe(100);
    expect(onBeatToleranceMs(bpmToBeatMs(240))).toBe(40);
  });

  it('节拍器：每拍 / 只响 2、4 拍 / 关', () => {
    expect([0, 1, 2, 3].map((b) => clickFor(b, 4, 'all', true))).toEqual([
      'accent',
      'normal',
      'normal',
      'normal',
    ]);
    expect(clickFor(4, 4, 'all', false)).toBe('normal');
    expect([0, 1, 2, 3].map((b) => clickFor(b, 4, 'backbeat', true))).toEqual([
      null,
      'normal',
      null,
      'normal',
    ]);
    expect(clickFor(-3, 4, 'all', true)).toBe('normal');
    expect(clickFor(-4, 4, 'all', true)).toBe('accent');
    expect(clickFor(0, 4, 'off', true)).toBeNull();
  });
});

describe('统计', () => {
  it('平均、标准差、直方图', () => {
    expect(mean([])).toBeNull();
    expect(stdev([])).toBeNull();
    expect(mean([1, 2, 3])).toBe(2);
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    const bins = histogram([-250, -15, 0, 5, 19, 300], { min: -40, max: 40, width: 20 });
    expect(bins.map((b) => b.count)).toEqual([1, 1, 3, 1]);
    expect(bins[0]).toMatchObject({ from: -40, to: -20 });
  });
});

describe('延迟校准', () => {
  const beats = Array.from({ length: 20 }, (_, i) => 1000 + i * 600);

  it('偏移 = 敲击相对拍点的中位数；去掉前几下和离群值', () => {
    const jitter = [3, -4, 6, -2, 0, 5, -6, 2, 4, -3, 1, -1, 2, 0];
    const taps = [
      1200, // 热身，不算
      1600 + 300, // 热身
      2200 + 100,
      2800 + 10,
      ...beats.slice(4, 18).map((b, i) => b + 45 + (jitter[i] as number)),
      beats[18] as number, // 离群
    ];
    const est = estimateLatency(taps, beats);
    expect(est).toMatchObject({ offsetMs: 46, ok: true, used: 14 });
    expect(est?.stdevMs).toBeLessThan(5);
  });

  it('太少或太乱：ok = false；没有拍点或敲击：null', () => {
    expect(estimateLatency([1000], beats)).toBeNull();
    expect(estimateLatency([], [1000])).toBeNull();
    const few = beats.slice(0, 8).map((b) => b + 30);
    expect(estimateLatency(few, beats)?.ok).toBe(false);
    const messy = beats.map((b, i) => b + (i % 2 ? 150 : -150) + 20);
    expect(estimateLatency(messy, beats)?.ok).toBe(false);
  });
});
