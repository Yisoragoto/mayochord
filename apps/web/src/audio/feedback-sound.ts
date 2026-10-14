/**
 * 答对、答错的提示音（设置里可关，默认关）。用 Web Audio 振荡器直接合成，
 * 不加载 Tone.js 和钢琴采样。
 */
let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function blip(
  ac: AudioContext,
  freq: number,
  at: number,
  dur: number,
  type: OscillatorType,
  gain: number,
) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

export function playFeedbackSound(kind: 'correct' | 'wrong') {
  const ac = context();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  if (kind === 'correct') {
    blip(ac, 1318.5, t, 0.12, 'sine', 0.12);
    blip(ac, 1760, t + 0.07, 0.16, 'sine', 0.1);
  } else {
    blip(ac, 196, t, 0.22, 'triangle', 0.16);
  }
}
