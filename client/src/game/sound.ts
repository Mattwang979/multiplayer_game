// 音效與配樂全部用 Web Audio 即時合成，不需要音檔。
// - 同一種聲音在很短時間內只會播一次，避免一大群部隊開火時爆音。
// - iPhone 的靜音開關預設會把網頁的 Web Audio 靜音，這裡用 audioSession 與一段無聲的 <audio> 把它切成「播放」模式。
// - 背景配樂是程序生成的軍樂進行曲（小鼓、大鼓、低音銅管、號角），戰況越危急越激烈。

type Kind =
  | "rifle" | "mg" | "cannon" | "at" | "shell" | "boom" | "bigboom" | "flak" | "whistle" | "siren" | "click" | "deploy" | "error" | "plane"
  | "capture" | "fortLost" | "victory" | "defeat" | "start" | "sniper" | "flame" | "event";

const SFX_VOLUME = 0.85;
const MUSIC_VOLUME = 0.32;

let ctx: AudioContext | null = null;
let out: GainNode | null = null; // 靜音開關
let master: GainNode | null = null; // 音效
let musicBus: GainNode | null = null; // 配樂
let noise: AudioBuffer | null = null;
let muted = false;
let musicMuted = false;
let unlockEl: HTMLAudioElement | null = null;
const last = new Map<Kind, number>();
const MIN_GAP: Partial<Record<Kind, number>> = {
  rifle: 0.05, mg: 0.09, cannon: 0.08, at: 0.08, shell: 0.12, boom: 0.07, bigboom: 0.15, flak: 0.08, plane: 1.5, click: 0.03,
  capture: 0.6, fortLost: 0.8, siren: 2, sniper: 0.1, flame: 0.12, event: 1,
};

try {
  muted = localStorage.getItem("frontline.muted") === "1";
  musicMuted = localStorage.getItem("frontline.music") === "0";
} catch {
  /* 無痕模式等情況讀不到就用預設 */
}

/** 0.4 秒的無聲 WAV，給 iOS 開啟媒體播放用 */
function silentWavUrl() {
  const rate = 8000;
  const n = rate * 0.4;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + n, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  w(36, "data");
  v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

/** 要在使用者點擊／觸控時呼叫（瀏覽器規定），重複呼叫沒關係 */
export function initAudio() {
  // iOS 17+：把網頁音訊設成「播放」類型，靜音開關打開時也有聲音
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  try {
    if (nav.audioSession && nav.audioSession.type !== "playback") nav.audioSession.type = "playback";
  } catch {
    /* 不支援就算了 */
  }
  // 較舊的 iOS：播一段無聲的 <audio>，讓整頁進入媒體播放模式
  if (!unlockEl) {
    unlockEl = document.createElement("audio");
    unlockEl.setAttribute("playsinline", "");
    unlockEl.setAttribute("x-webkit-airplay", "deny");
    unlockEl.preload = "auto";
    unlockEl.loop = true;
    unlockEl.src = silentWavUrl();
  }
  if (unlockEl.paused) unlockEl.play().catch(() => {});

  if (ctx) {
    if (ctx.state !== "running") void ctx.resume();
    return;
  }
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  out = ctx.createGain();
  out.gain.value = muted ? 0 : 1;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  out.connect(comp).connect(ctx.destination);
  master = ctx.createGain();
  master.gain.value = SFX_VOLUME;
  master.connect(out);
  musicBus = ctx.createGain();
  musicBus.gain.value = musicMuted ? 0 : MUSIC_VOLUME;
  musicBus.connect(out);
  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // 播一個極短的空白聲音，解鎖 iOS
  const b = ctx.createBufferSource();
  b.buffer = ctx.createBuffer(1, 1, 22050);
  b.connect(ctx.destination);
  b.start(0);
  // 從背景回來時恢復
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && ctx && ctx.state !== "running") void ctx.resume();
  });
  if (musicWanted) startMusic();
}

export function toggleMute() {
  muted = !muted;
  if (out && ctx) out.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.02);
  try {
    localStorage.setItem("frontline.muted", muted ? "1" : "0");
  } catch {
    /* ignore */
  }
  return muted;
}
export const isMuted = () => muted;

export function toggleMusic() {
  musicMuted = !musicMuted;
  if (musicBus && ctx) musicBus.gain.setTargetAtTime(musicMuted ? 0 : MUSIC_VOLUME, ctx.currentTime, 0.1);
  try {
    localStorage.setItem("frontline.music", musicMuted ? "0" : "1");
  } catch {
    /* ignore */
  }
  return !musicMuted;
}
export const isMusicOn = () => !musicMuted;

// ================================================================ 合成積木

function noiseBurst(
  t: number, dur: number, gain: number, filterType: BiquadFilterType, freq: number, q = 1, endFreq?: number, dest: AudioNode | null = master, attack = 0,
) {
  if (!ctx || !dest || !noise) return;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.setValueAtTime(freq, t);
  if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  if (attack > 0) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
  } else g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 1.2, dur + 0.05);
}

function tone(t: number, dur: number, gain: number, type: OscillatorType, f0: number, f1: number, dest: AudioNode | null = master) {
  if (!ctx || !dest) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** 銅管：兩個略為走音的鋸齒波＋濾波器快速打開，聽起來像號角 */
function brass(t: number, dur: number, freq: number, gain: number, dest: AudioNode | null = master, bright = 2600) {
  if (!ctx || !dest) return;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.Q.value = 2;
  f.frequency.setValueAtTime(freq * 1.2, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(freq * 2, bright), t + 0.05);
  f.frequency.exponentialRampToValueAtTime(Math.max(freq * 1.5, bright * 0.55), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.025);
  g.gain.setValueAtTime(gain * 0.8, t + Math.max(0.03, dur - 0.06));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
  f.connect(g).connect(dest);
  const vib = ctx.createOscillator();
  const vg = ctx.createGain();
  vib.frequency.value = 5.5;
  vg.gain.value = freq * 0.006;
  vib.connect(vg);
  for (const det of [-6, 6]) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    o.detune.value = det;
    vg.connect(o.frequency);
    o.connect(f);
    o.start(t);
    o.stop(t + dur + 0.12);
  }
  vib.start(t);
  vib.stop(t + dur + 0.12);
}

function snare(t: number, gain: number, dest: AudioNode | null = master) {
  noiseBurst(t, 0.16, gain, "highpass", 1800, 0.7, undefined, dest);
  noiseBurst(t, 0.09, gain * 0.7, "bandpass", 900, 1.2, undefined, dest);
  tone(t, 0.06, gain * 0.5, "triangle", 260, 180, dest);
}

function kick(t: number, gain: number, dest: AudioNode | null = master) {
  tone(t, 0.32, gain, "sine", 110, 38, dest);
  noiseBurst(t, 0.05, gain * 0.25, "lowpass", 900, 0.7, undefined, dest);
}

function timpani(t: number, freq: number, gain: number, dest: AudioNode | null = master) {
  tone(t, 0.9, gain, "sine", freq * 1.04, freq, dest);
  tone(t, 0.5, gain * 0.35, "sine", freq * 2.01, freq * 2, dest);
  noiseBurst(t, 0.08, gain * 0.25, "lowpass", 600, 0.7, undefined, dest);
}

function crackle(t: number, span: number, count: number, gain: number) {
  for (let i = 0; i < count; i++) {
    const dt = Math.random() * span;
    noiseBurst(t + dt, 0.03 + Math.random() * 0.04, gain * (0.4 + Math.random() * 0.6), "highpass", 2500 + Math.random() * 2500, 0.8);
  }
}

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12); // MIDI 音高轉頻率

/** volume：0~1，依距離畫面中心遠近調整 */
export function play(kind: Kind, volume = 1) {
  if (!ctx || muted || volume <= 0.02) return;
  const now = ctx.currentTime;
  const gap = MIN_GAP[kind] ?? 0;
  if (now - (last.get(kind) ?? -1) < gap) return;
  last.set(kind, now);
  const v = Math.min(1.2, volume);
  switch (kind) {
    case "sniper":
      // 尖銳槍響＋長長的回音
      noiseBurst(now, 0.03, 0.8 * v, "highpass", 3500, 0.7);
      noiseBurst(now, 0.6, 0.35 * v, "bandpass", 1400, 0.5, 500);
      tone(now, 0.1, 0.25 * v, "triangle", 900, 300);
      break;
    case "flame":
      // 火焰噴射的呼呼聲
      noiseBurst(now, 0.45, 0.5 * v, "bandpass", 600, 0.8, 300, master, 0.05);
      noiseBurst(now, 0.3, 0.2 * v, "highpass", 2500, 0.5);
      break;
    case "event": {
      // 事件通知：兩聲短號角
      brass(now, 0.12, NOTE(72), 0.16 * v);
      brass(now + 0.15, 0.3, NOTE(79), 0.16 * v);
      snare(now, 0.2 * v);
      break;
    }
    case "rifle":
      noiseBurst(now, 0.035, 0.55 * v, "highpass", 3000, 0.7);
      noiseBurst(now, 0.12, 0.32 * v, "bandpass", 1100, 0.9);
      break;
    case "mg":
      for (let i = 0; i < 4; i++) {
        const t = now + i * 0.055;
        noiseBurst(t, 0.03, 0.4 * v, "highpass", 2600 + Math.random() * 600, 0.7);
        noiseBurst(t, 0.06, 0.28 * v, "bandpass", 1000 + Math.random() * 300, 1);
      }
      break;
    case "cannon":
      noiseBurst(now, 0.03, 0.6 * v, "highpass", 2000, 0.6);
      noiseBurst(now, 0.45, 0.8 * v, "lowpass", 1100, 0.7, 120);
      tone(now, 0.35, 0.6 * v, "sine", 120, 35);
      break;
    case "at":
      noiseBurst(now, 0.03, 0.5 * v, "highpass", 2400, 0.6);
      noiseBurst(now, 0.28, 0.6 * v, "bandpass", 1300, 0.6, 400);
      tone(now, 0.15, 0.32 * v, "triangle", 320, 90);
      break;
    case "shell":
      noiseBurst(now, 0.04, 0.6 * v, "highpass", 1600, 0.6);
      noiseBurst(now, 0.7, 0.8 * v, "lowpass", 700, 0.7, 70);
      tone(now, 0.5, 0.6 * v, "sine", 85, 28);
      break;
    case "boom":
      tone(now, 0.7, 0.9 * v, "sine", 95, 26);
      noiseBurst(now, 1.1, 1.0 * v, "lowpass", 2200, 0.6, 70);
      noiseBurst(now, 0.06, 0.6 * v, "highpass", 1500, 0.6);
      crackle(now + 0.05, 0.5, 6, 0.25 * v);
      break;
    case "bigboom":
      tone(now, 1.4, 1.0 * v, "sine", 75, 20);
      tone(now, 1.8, 0.6 * v, "sine", 48, 16);
      noiseBurst(now, 2.0, 1.1 * v, "lowpass", 2600, 0.5, 45);
      noiseBurst(now, 0.08, 0.8 * v, "highpass", 1200, 0.6);
      crackle(now + 0.08, 1.2, 14, 0.3 * v);
      break;
    case "flak":
      noiseBurst(now, 0.04, 0.55 * v, "highpass", 2200, 0.6);
      noiseBurst(now, 0.25, 0.5 * v, "bandpass", 700, 1.2, 300);
      tone(now, 0.12, 0.3 * v, "sine", 160, 60);
      break;
    case "whistle": {
      if (!ctx || !master) return;
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(1700, now);
      o.frequency.exponentialRampToValueAtTime(420, now + 1.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.16 * v, now + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);
      o.connect(g).connect(master);
      o.start(now);
      o.stop(now + 1.2);
      break;
    }
    case "siren": {
      if (!ctx || !master) return;
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 1500;
      o.frequency.setValueAtTime(380, now);
      o.frequency.linearRampToValueAtTime(760, now + 0.9);
      o.frequency.linearRampToValueAtTime(380, now + 1.8);
      o.frequency.linearRampToValueAtTime(760, now + 2.7);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.16 * v, now + 0.2);
      g.gain.setValueAtTime(0.16 * v, now + 2.5);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 3);
      o.connect(f).connect(g).connect(master);
      o.start(now);
      o.stop(now + 3.1);
      break;
    }
    case "plane": {
      if (!ctx || !master) return;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 420;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.2 * v, now + 0.5);
      g.gain.setValueAtTime(0.2 * v, now + 1.8);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 2.8);
      f.connect(g).connect(master);
      for (const fr of [82, 86.5, 123]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(fr, now);
        o.frequency.linearRampToValueAtTime(fr * 0.93, now + 2.8);
        o.connect(f);
        o.start(now);
        o.stop(now + 2.9);
      }
      noiseBurst(now, 2.6, 0.12 * v, "lowpass", 500, 1.5, 250, master, 0.4);
      break;
    }
    case "click":
      tone(now, 0.04, 0.18 * v, "square", 1000, 700);
      break;
    case "deploy":
      tone(now, 0.07, 0.16 * v, "square", 523, 523);
      tone(now + 0.065, 0.1, 0.16 * v, "square", 784, 784);
      noiseBurst(now, 0.05, 0.12 * v, "highpass", 3000, 0.7);
      break;
    case "error":
      tone(now, 0.15, 0.16 * v, "square", 220, 160);
      break;
    case "capture": {
      // 號角：G4 C5 E5 G5（長）
      const seq: [number, number, number][] = [[67, 0, 0.12], [72, 0.13, 0.12], [76, 0.26, 0.12], [79, 0.39, 0.55]];
      for (const [n, at, d] of seq) brass(now + at, d, NOTE(n), 0.2 * v);
      snare(now + 0.39, 0.3 * v);
      timpani(now + 0.39, NOTE(43), 0.5 * v);
      break;
    }
    case "fortLost": {
      // 下行小調：E4 C4 A3，加低沉鼓聲
      const seq: [number, number, number][] = [[64, 0, 0.28], [60, 0.3, 0.28], [57, 0.6, 0.8]];
      for (const [n, at, d] of seq) brass(now + at, d, NOTE(n), 0.18 * v, master, 1500);
      timpani(now, NOTE(40), 0.6 * v);
      timpani(now + 0.6, NOTE(33), 0.7 * v);
      break;
    }
    case "start": {
      // 衝鋒號：G4 C5 E5 G5 E5 G5～，小鼓滾奏
      const seq: [number, number, number][] = [[67, 0, 0.1], [72, 0.12, 0.1], [76, 0.24, 0.1], [79, 0.36, 0.22], [76, 0.6, 0.1], [79, 0.72, 0.7]];
      for (const [n, at, d] of seq) brass(now + at, d, NOTE(n), 0.2 * v);
      for (let i = 0; i < 12; i++) snare(now + i * 0.06, (0.1 + i * 0.02) * v);
      timpani(now + 0.72, NOTE(43), 0.7 * v);
      break;
    }
    case "victory": {
      // 凱旋：C5 C5 C5 G5～ 然後大三和弦
      const seq: [number, number, number][] = [[72, 0, 0.14], [72, 0.16, 0.14], [72, 0.32, 0.14], [79, 0.5, 0.5], [76, 1.05, 0.2], [79, 1.3, 1.4]];
      for (const [n, at, d] of seq) brass(now + at, d, NOTE(n), 0.2 * v);
      for (const n of [60, 64, 67]) brass(now + 1.3, 1.4, NOTE(n), 0.12 * v, master, 1800);
      for (let i = 0; i < 16; i++) snare(now + 0.8 + i * 0.03, (0.08 + i * 0.015) * v);
      timpani(now + 1.3, NOTE(36), 0.8 * v);
      noiseBurst(now + 1.3, 2.2, 0.35 * v, "highpass", 5000, 0.5); // 鈸
      break;
    }
    case "defeat": {
      // 緩慢下行：A3 F3 D3，低沉
      const seq: [number, number, number][] = [[57, 0, 0.6], [53, 0.65, 0.6], [50, 1.3, 1.6]];
      for (const [n, at, d] of seq) brass(now + at, d, NOTE(n), 0.16 * v, master, 900);
      for (let i = 0; i < 3; i++) timpani(now + i * 0.65, NOTE(38 - i * 2), 0.6 * v);
      break;
    }
  }
}

// ================================================================ 背景配樂（程序生成的軍樂進行曲）

let musicWanted = false;
let musicTimer = 0;
let nextStep = 0;
let step = 0;
let intensity = 0; // 0 平穩、1 交戰、2 危急
let musicGain: GainNode | null = null;

// D 小調進行：i - VI - VII - V（Dm - B♭ - C - A），每小節一個和弦
const CHORDS = [
  [50, 53, 57], // Dm
  [46, 50, 53], // B♭
  [48, 52, 55], // C
  [45, 49, 52], // A
];
// 號角動機（相對和弦根音的半音，-1 = 休息），16 分音符一格
const MOTIF = [12, -1, -1, 12, 15, -1, 12, -1, 19, -1, -1, 17, 15, -1, 12, -1];
const MOTIF_B = [19, -1, -1, 19, 17, -1, 15, -1, 12, -1, 15, -1, 14, -1, -1, -1];
// 小鼓：進行曲節奏的力度（0 = 不打）
const SNARE = [0, 0, 0, 0, 1, 0, 0, 0.35, 0, 0, 0.5, 0.35, 1, 0, 0.4, 0.4];

export function setMusicIntensity(level: number) {
  intensity = Math.max(0, Math.min(2, level));
}

export function startMusic() {
  musicWanted = true;
  if (!ctx || !musicBus || musicTimer) return;
  musicGain = ctx.createGain();
  musicGain.gain.setValueAtTime(0.0001, ctx.currentTime);
  musicGain.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 2);
  musicGain.connect(musicBus);
  nextStep = ctx.currentTime + 0.1;
  step = 0;
  musicTimer = window.setInterval(scheduleMusic, 60);
  scheduleMusic();
}

export function stopMusic(fade = 1.5) {
  musicWanted = false;
  if (musicTimer) {
    clearInterval(musicTimer);
    musicTimer = 0;
  }
  if (ctx && musicGain) {
    const g = musicGain;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + fade);
    setTimeout(() => g.disconnect(), fade * 1000 + 200);
    musicGain = null;
  }
}

function scheduleMusic() {
  if (!ctx || !musicGain) return;
  // 分頁在背景時計時器會變慢，跳過已經來不及的拍子
  if (nextStep < ctx.currentTime - 0.2) nextStep = ctx.currentTime + 0.05;
  while (nextStep < ctx.currentTime + 0.25) {
    playStep(step, nextStep);
    const bpm = intensity >= 2 ? 132 : intensity >= 1 ? 120 : 108;
    nextStep += 60 / bpm / 4;
    step++;
  }
}

function playStep(i: number, t: number) {
  const dest = musicGain;
  if (!dest) return;
  const s16 = i % 16;
  const bar = Math.floor(i / 16) % 4;
  const phrase = Math.floor(i / 64) % 2;
  const chord = CHORDS[bar];
  const root = chord[0];
  const lv = intensity;

  // 大鼓：每拍 1、3（危急時每拍）
  if (s16 === 0 || s16 === 8 || (lv >= 2 && (s16 === 4 || s16 === 12))) kick(t, 0.55, dest);
  // 小鼓進行曲節奏；最後一小節滾奏
  const sn = SNARE[s16];
  if (sn > 0) snare(t, 0.22 * sn * (lv >= 1 ? 1 : 0.7), dest);
  if (bar === 3 && s16 >= 12 && lv >= 1) snare(t + 30 / 120 / 4, 0.1, dest);
  // 低音銅管：根音、五度
  if (s16 === 0 || s16 === 6 || s16 === 8 || s16 === 14) {
    const n = s16 === 8 ? chord[2] - 12 : root - 12;
    brass(t, 0.18, NOTE(n), 0.14, dest, 700);
  }
  // 定音鼓：每小節開頭
  if (s16 === 0) timpani(t, NOTE(root - 12), lv >= 1 ? 0.35 : 0.22, dest);
  // 號角動機（交戰以上）
  if (lv >= 1) {
    const motif = phrase === 0 ? MOTIF : MOTIF_B;
    const m = motif[s16];
    if (m >= 0) brass(t, 0.16, NOTE(root + m), lv >= 2 ? 0.1 : 0.075, dest, 2200);
  }
  // 危急：和弦 16 分音符震音
  if (lv >= 2) {
    const n = chord[s16 % 3] + 12;
    tone(t, 0.09, 0.035, "triangle", NOTE(n), NOTE(n), dest);
  }
}
