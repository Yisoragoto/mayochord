import { bpmToBeatMs, type RhythmPattern, TPQ } from '@mayochord/core';
import { type Metronome, startMetronome } from './metronome';
import { loadTone, perfToContextTime } from './tone';

/** 节拍器按四分音符响：6/8 一小节 3 下，3/4 3 下，4/4 4 下 */
export function quarterBeatsPerBar(time: readonly [number, number]): number {
  return Math.max(1, Math.round((time[0] * 4) / time[1]));
}

export interface RhythmPlayback {
  metronome: Metronome;
  /** 每个起点（performance.now() 域，已换算到出声时刻） */
  onsetTimes: number[];
  stop(): void;
}

/**
 * 节奏读谱：预备一小节后，节拍器继续响 bars 小节。demo = true 时在每个起点再敲一下（示范），
 * 否则只有节拍器（用户自己按）。第 0 拍 = 预备小节之后的第一拍。
 */
export async function playRhythm(
  pattern: RhythmPattern,
  time: readonly [number, number],
  bpm: number,
  opts: { demo: boolean; volume?: number; onBeat?: (beat: number) => void },
): Promise<RhythmPlayback> {
  const tone = await loadTone();
  const beatsPerBar = quarterBeatsPerBar(time);
  const metronome = await startMetronome({
    bpm,
    beatsPerBar,
    mode: 'all',
    accent: true,
    countInBeats: beatsPerBar,
    ...(opts.volume !== undefined ? { volume: opts.volume } : {}),
    ...(opts.onBeat ? { onBeat: opts.onBeat } : {}),
  });
  const beatMs = bpmToBeatMs(bpm);
  const onsetTimes = pattern.onsets.map((tick) => metronome.grid.startT + (tick / TPQ) * beatMs);
  const disposables: { dispose(): unknown }[] = [];
  if (opts.demo) {
    const gain = new tone.Gain(0.7).toDestination();
    const synth = new tone.MembraneSynth({
      pitchDecay: 0.01,
      octaves: 2,
      envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 },
    }).connect(gain);
    disposables.push(synth, gain);
    for (const t of onsetTimes) {
      const at = perfToContextTime(t);
      if (at !== null) synth.triggerAttackRelease('C3', 0.08, at);
    }
  }
  // 小节结束后停掉节拍器（多留半拍，让最后一个音能响完）
  const endT = metronome.grid.startT + (pattern.length / TPQ) * beatMs;
  const timer = setTimeout(() => stop(), Math.max(0, endT - performance.now() + beatMs / 2));
  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    metronome.stop();
    setTimeout(() => {
      for (const d of disposables) d.dispose();
    }, 300);
  }
  return { metronome, onsetTimes, stop };
}
