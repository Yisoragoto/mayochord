import type { LoadedPack, ProgressionEntry } from '@mayochord/content';
import {
  type ChordSymbol,
  chordSlug,
  closeVoicing,
  parseChordSymbol,
  type RunSpec,
  type VoicedNote,
  type VoicingMode,
} from '@mayochord/core';

/** 进行练习里的一个和弦：内容包里有的用参考键位，没有的（自定义序列）自动排列 */
export interface RunChord {
  id: string;
  symbol: ChordSymbol;
  notes: readonly VoicedNote[];
  generated: boolean;
}

/** 一条要练的进行（内置进行或自定义序列） */
export interface RunSource {
  /** 内置进行的 ID，或 'custom' */
  id: string;
  /** 每一步 */
  steps: { chord: RunChord; beats: number; anticipation: number }[];
}

export function sourceFromProgression(p: ProgressionEntry): RunSource {
  return {
    id: p.id,
    steps: p.steps.map((s) => ({
      chord: {
        id: s.chord.id,
        symbol: s.chord.symbol,
        notes: s.voicing.notes,
        generated: s.voicing.status === 'generated',
      },
      beats: s.beats,
      anticipation: s.anticipation,
    })),
  };
}

export type ParseResult = { ok: true; source: RunSource } | { ok: false; bad: string[] };

/**
 * 自定义序列：和弦名用空格、逗号、短横线或竖线分隔，例如 "FM7 E7 Am7 Gm7 C7(9)"。
 * 内容包里有的和弦用它的参考键位，其他的按公式自动排列（左手根音，右手密集排列）。
 */
export function parseCustomSequence(text: string, pack: LoadedPack, beats: number): ParseResult {
  const tokens = text
    .split(/[\s,，|–—]+|\s-\s/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t !== '-');
  const bad: string[] = [];
  const steps: RunSource['steps'] = [];
  for (const token of tokens) {
    const symbol = parseChordSymbol(token);
    if (!symbol?.rootName) {
      bad.push(token);
      continue;
    }
    const id = chordSlug(symbol.rootName, symbol.quality, symbol.bassName);
    const entry = pack.chordById.get(id);
    const chord: RunChord = entry
      ? {
          id,
          symbol: entry.symbol,
          notes: entry.reference.notes,
          generated: entry.reference.status === 'generated',
        }
      : {
          id,
          symbol,
          notes: closeVoicing(symbol.rootName, symbol.quality, symbol.bassName),
          generated: true,
        };
    steps.push({ chord, beats, anticipation: 0 });
  }
  if (bad.length > 0 || steps.length === 0) return { ok: false, bad };
  return { ok: true, source: { id: 'custom', steps } };
}

export interface RunOptions {
  bpm: number;
  /** 每个和弦几拍；0 = 按进行自带的拍数 */
  beatsPerChord: number;
  loops: number | null;
  voicingMode: VoicingMode;
  hintsVisible: boolean;
  latencyMs: number;
  onsetWindowMs: number;
  beatsPerBar?: number;
}

export function runSpecFrom(source: RunSource, o: RunOptions): RunSpec {
  const beatsPerBar = o.beatsPerBar ?? 4;
  return {
    steps: source.steps.map((s) => ({
      chordId: s.chord.id,
      target: s.chord.notes.map((n) => n.midi),
      slash: s.chord.symbol.bass !== undefined && s.chord.symbol.bass !== s.chord.symbol.root,
      beats: o.beatsPerChord > 0 ? o.beatsPerChord : s.beats,
      anticipation: s.anticipation,
    })),
    loops: o.loops,
    bpm: o.bpm,
    beatsPerBar,
    countInBeats: beatsPerBar,
    voicingMode: o.voicingMode,
    hintsVisible: o.hintsVisible,
    latencyMs: o.latencyMs,
    onsetWindowMs: o.onsetWindowMs,
  };
}

/** 这条进行默认的 BPM（没有练过时） */
export const DEFAULT_BPM = 72;
