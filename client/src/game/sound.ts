// 音效全部用 Web Audio 即時合成，不需要音檔。
// 同一種聲音在很短時間內只會播一次，避免一大群部隊開火時爆音。

type Kind = "rifle" | "mg" | "cannon" | "at" | "shell" | "boom" | "bigboom" | "flak" | "whistle" | "siren" | "click" | "deploy" | "error" | "plane";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = false;
const last = new Map<Kind, number>();
const MIN_GAP: Partial<Record<Kind, number>> = { rifle: 0.06, mg: 0.09, cannon: 0.08, at: 0.08, shell: 0.12, boom: 0.07, flak: 0.08, plane: 1.5, click: 0.03 };

export function initAudio() {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}
export const isMuted = () => muted;

function noiseBurst(t: number, dur: number, gain: number, filterType: BiquadFilterType, freq: number, q = 1, endFreq?: number) {
  if (!ctx || !master || !noise) return;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.setValueAtTime(freq, t);
  if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

function tone(t: number, dur: number, gain: number, type: OscillatorType, f0: number, f1: number) {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** volume：0~1，依距離畫面中心遠近調整 */
export function play(kind: Kind, volume = 1) {
  if (!ctx || muted || volume <= 0.02) return;
  const now = ctx.currentTime;
  const gap = MIN_GAP[kind] ?? 0;
  if (now - (last.get(kind) ?? -1) < gap) return;
  last.set(kind, now);
  const v = volume;
  switch (kind) {
    case "rifle":
      noiseBurst(now, 0.08, 0.35 * v, "bandpass", 2200, 0.8);
      break;
    case "mg":
      for (let i = 0; i < 3; i++) noiseBurst(now + i * 0.06, 0.05, 0.3 * v, "bandpass", 1800, 0.9);
      break;
    case "cannon":
      noiseBurst(now, 0.35, 0.7 * v, "lowpass", 900, 0.7, 120);
      tone(now, 0.25, 0.4 * v, "sine", 120, 40);
      break;
    case "at":
      noiseBurst(now, 0.22, 0.55 * v, "bandpass", 1300, 0.6);
      tone(now, 0.12, 0.25 * v, "triangle", 300, 90);
      break;
    case "shell":
      noiseBurst(now, 0.5, 0.6 * v, "lowpass", 600, 0.7, 80);
      break;
    case "boom":
      noiseBurst(now, 0.7, 0.9 * v, "lowpass", 1200, 0.6, 60);
      tone(now, 0.5, 0.5 * v, "sine", 90, 30);
      break;
    case "bigboom":
      noiseBurst(now, 1.6, 1.0 * v, "lowpass", 1400, 0.5, 40);
      tone(now, 1.2, 0.8 * v, "sine", 70, 22);
      break;
    case "flak":
      noiseBurst(now, 0.18, 0.4 * v, "bandpass", 700, 1.2);
      break;
    case "whistle":
      tone(now, 0.9, 0.12 * v, "sine", 1800, 500);
      break;
    case "siren": {
      if (!ctx || !master) return;
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 1400;
      o.frequency.setValueAtTime(380, now);
      o.frequency.linearRampToValueAtTime(760, now + 0.9);
      o.frequency.linearRampToValueAtTime(380, now + 1.8);
      o.frequency.linearRampToValueAtTime(760, now + 2.7);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.12 * v, now + 0.2);
      g.gain.setValueAtTime(0.12 * v, now + 2.5);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 3);
      o.connect(f).connect(g).connect(master);
      o.start(now);
      o.stop(now + 3.1);
      break;
    }
    case "plane":
      noiseBurst(now, 2.2, 0.18 * v, "lowpass", 300, 2, 200);
      tone(now, 2.2, 0.06 * v, "sawtooth", 95, 80);
      break;
    case "click":
      tone(now, 0.05, 0.15 * v, "square", 900, 600);
      break;
    case "deploy":
      tone(now, 0.08, 0.15 * v, "square", 520, 520);
      tone(now + 0.07, 0.1, 0.15 * v, "square", 780, 780);
      break;
    case "error":
      tone(now, 0.15, 0.15 * v, "square", 220, 160);
      break;
  }
}
