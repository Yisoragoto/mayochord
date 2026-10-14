import { create } from 'zustand';

/**
 * 网页钢琴音源（扩展点 4.2-2 的 Web Audio 实现）：Salamander Grand Piano 采样，Tone.js Sampler。
 * Tone.js 和采样文件都在第一次需要发声时才加载。
 */
export interface AudioOutput {
  /** 同时或分解地弹一组音 */
  playNotes(notes: readonly number[], opts?: PlayOptions): void;
  noteOn(note: number, velocity?: number): void;
  noteOff(note: number): void;
  releaseAll(): void;
}

export interface PlayOptions {
  /** 每个音的时值（秒），默认 1.6 */
  duration?: number;
  /** 分解和弦时相邻两个音的间隔（秒），0 = 同时，默认 0 */
  stagger?: number;
  /** 力度 0–127，默认 80 */
  velocity?: number;
}

export type PianoStatus = 'idle' | 'loading' | 'ready' | 'error';
export const usePianoStatus = create<{ status: PianoStatus }>()(() => ({ status: 'idle' }));

type ToneModule = typeof import('tone');

/** Salamander 采样：A0 起每小三度一个，直到 C8（文件名里的 s 表示升号） */
function sampleUrls(): Record<string, string> {
  const urls: Record<string, string> = { A0: 'A0.mp3', C8: 'C8.mp3' };
  for (let oct = 1; oct <= 7; oct++) {
    urls[`C${oct}`] = `C${oct}.mp3`;
    urls[`D#${oct}`] = `Ds${oct}.mp3`;
    urls[`F#${oct}`] = `Fs${oct}.mp3`;
    urls[`A${oct}`] = `A${oct}.mp3`;
  }
  return urls;
}

class SamplerPiano implements AudioOutput {
  constructor(
    private readonly tone: ToneModule,
    private readonly sampler: import('tone').Sampler,
  ) {}

  private name(note: number): string {
    return this.tone.Frequency(note, 'midi').toNote();
  }

  playNotes(notes: readonly number[], opts: PlayOptions = {}) {
    const { duration = 1.6, stagger = 0, velocity = 80 } = opts;
    const now = this.tone.now() + 0.02;
    [...notes]
      .sort((a, b) => a - b)
      .forEach((n, i) => {
        this.sampler.triggerAttackRelease(
          this.name(n),
          duration,
          now + i * stagger,
          velocity / 127,
        );
      });
  }

  noteOn(note: number, velocity = 80) {
    this.sampler.triggerAttack(this.name(note), this.tone.now(), velocity / 127);
  }

  noteOff(note: number) {
    this.sampler.triggerRelease(this.name(note), this.tone.now());
  }

  releaseAll() {
    this.sampler.releaseAll();
  }
}

let piano: Promise<AudioOutput> | null = null;
let ready: AudioOutput | null = null;

/**
 * 取得钢琴音源（第一次调用时加载）。必须在用户手势（点击、按键）里调用，
 * 浏览器才允许启动 AudioContext。
 */
export function getPiano(): Promise<AudioOutput> {
  piano ??= (async () => {
    usePianoStatus.setState({ status: 'loading' });
    try {
      const tone = await import('tone');
      await tone.start();
      const sampler = new tone.Sampler({
        urls: sampleUrls(),
        baseUrl: `${import.meta.env.BASE_URL}samples/salamander/`,
        release: 1,
        volume: -6,
      }).toDestination();
      await tone.loaded();
      ready = new SamplerPiano(tone, sampler);
      usePianoStatus.setState({ status: 'ready' });
      return ready;
    } catch (err) {
      piano = null;
      usePianoStatus.setState({ status: 'error' });
      throw err;
    }
  })();
  return piano;
}

/** 已加载好的音源；还没加载时为 null（实时弹奏时不等待加载，避免延迟发声） */
export function readyPiano(): AudioOutput | null {
  return ready;
}
