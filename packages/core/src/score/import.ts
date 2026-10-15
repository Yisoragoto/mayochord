import { strFromU8 } from 'fflate';
import { midiToScore, parseMidiFile } from './midi-file';
import type { Score } from './model';
import { extractMxl, parseMusicXml, ScoreImportError } from './musicxml';

/** 存进本地乐谱库的原始内容（MusicXML 文本，或 MIDI 文件的 base64）。保存原文，解析器改进后重新解析即可。 */
export type ScoreSource = { kind: 'musicxml'; text: string } | { kind: 'midi'; base64: string };

export type ScoreFileFormat = 'musicxml' | 'mxl' | 'midi';

/** 按文件内容判断格式（不看扩展名）：MThd → MIDI，PK → .mxl，否则当作 XML。 */
export function detectScoreFormat(bytes: Uint8Array): ScoreFileFormat | null {
  const head = String.fromCharCode(...bytes.subarray(0, 4));
  if (head === 'MThd') return 'midi';
  if (head.startsWith('PK')) return 'mxl';
  const text = decodeText(bytes.subarray(0, 512)).trimStart();
  return text.startsWith('<') ? 'musicxml' : null;
}

/** UTF-8（含 BOM）或带 BOM 的 UTF-16 */
export function decodeText(bytes: Uint8Array): string {
  const le = bytes[0] === 0xff && bytes[1] === 0xfe;
  const be = bytes[0] === 0xfe && bytes[1] === 0xff;
  if (!le && !be) return strFromU8(bytes);
  let s = '';
  for (let i = 2; i + 1 < bytes.length; i += 2) {
    const a = bytes[i] as number;
    const b = bytes[i + 1] as number;
    s += String.fromCharCode(le ? a | (b << 8) : (a << 8) | b);
  }
  return s;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63];
    out += B64[(n >> 12) & 63];
    out += b === undefined ? '=' : B64[(n >> 6) & 63];
    out += c === undefined ? '=' : B64[n & 63];
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v = [0, 1, 2, 3].map((j) => B64.indexOf(clean[i + j] ?? 'A'));
    const n =
      ((v[0] as number) << 18) |
      ((v[1] as number) << 12) |
      ((v[2] as number) << 6) |
      (v[3] as number);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** 文件名去掉扩展名，作为没有标题时的标题 */
export function titleFromFileName(name: string): string {
  return name.replace(/\.(musicxml|mxl|xml|midi?|kar)$/i, '').trim();
}

/** 读入一个乐谱文件：判断格式、解析、得到要保存的原文。解析失败抛 ScoreImportError。 */
export function importScoreFile(
  bytes: Uint8Array,
  fileName: string,
): { score: Score; source: ScoreSource; format: ScoreFileFormat } {
  const format = detectScoreFormat(bytes);
  const title = titleFromFileName(fileName);
  if (format === 'midi') {
    const source: ScoreSource = { kind: 'midi', base64: toBase64(bytes) };
    return { score: parseScoreSource(source, title), source, format };
  }
  if (format === 'mxl' || format === 'musicxml') {
    const text = format === 'mxl' ? extractMxl(bytes) : decodeText(bytes);
    const source: ScoreSource = { kind: 'musicxml', text };
    return { score: parseScoreSource(source, title), source, format };
  }
  throw new ScoreImportError('unknown-format');
}

/** 由保存的原文重新解析出乐谱 */
export function parseScoreSource(source: ScoreSource, title = ''): Score {
  return source.kind === 'midi'
    ? midiToScore(parseMidiFile(fromBase64(source.base64)), title)
    : parseMusicXml(source.text, title);
}
