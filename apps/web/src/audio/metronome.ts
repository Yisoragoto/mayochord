import { audioToPerf, type BeatGrid, bpmToBeatMs, type ClickMode, clickFor } from '@mayochord/core';
import { loadTone, outputStamp } from './tone';

export interface MetronomeOptions {
  bpm: number;
  beatsPerBar: number;
  mode: ClickMode;
  accent: boolean;
  /** 预备拍：这些拍总是每拍都响（强拍重音），之后才按 mode */
  countInBeats: number;
  /** 0–1 */
  volume?: number;
  /** 每一拍（含预备拍，beat < 0）到来时回调，beat 从 -countInBeats 起 */
  onBeat?: (beat: number) => void;
}

export interface Metronome {
  /** 节拍网格：第 0 拍 = 预备拍之后的第一个强拍，performance.now() 域（已换算到实际出声的时刻） */
  grid: BeatGrid;
  stop(): void;
}

/**
 * 节拍器（规格 9）：Tone.Clock 按音频时钟调度，不依赖 setInterval 的精度。
 * 返回的节拍网格换算到 performance.now() 域，与 MIDI 输入的时间戳直接比较。
 */
export async function startMetronome(opts: MetronomeOptions): Promise<Metronome> {
  const tone = await loadTone();
  const ctx = tone.getContext().rawContext as AudioContext;
  const beatSec = bpmToBeatMs(opts.bpm) / 1000;
  const startAudio = tone.now() + 0.2;
  const gain = new tone.Gain(opts.volume ?? 0.6).toDestination();
  const synth = new tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
  }).connect(gain);

  const clock = new tone.Clock((time, ticks = 0) => {
    const beat = Math.round(ticks) - opts.countInBeats;
    const click =
      beat < 0
        ? clickFor(beat, opts.beatsPerBar, 'all', true)
        : clickFor(beat, opts.beatsPerBar, opts.mode, opts.accent);
    if (click) synth.triggerAttackRelease(click === 'accent' ? 1760 : 1175, 0.04, time);
    if (opts.onBeat) {
      // 回调在调度时（略早于出声）执行：等到出声时再通知界面
      const delay = Math.max(0, (time - tone.now()) * 1000);
      setTimeout(() => opts.onBeat?.(beat), delay);
    }
  }, 1 / beatSec);
  clock.start(startAudio);

  const firstBeatAudio = startAudio + opts.countInBeats * beatSec;
  const grid: BeatGrid = {
    startT: audioToPerf(firstBeatAudio, outputStamp(ctx)),
    beatMs: beatSec * 1000,
    beatsPerBar: opts.beatsPerBar,
  };
  return {
    grid,
    stop() {
      clock.stop();
      clock.dispose();
      setTimeout(() => {
        synth.dispose();
        gain.dispose();
      }, 200);
    },
  };
}
