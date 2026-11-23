/* =========================================================
   DAUD TRACK — sound
   Everything is synthesised with Web Audio (no files to load).
   Starts on the first tap / key press (browsers block sound before that).
   To use a real track later: put music.mp3 next to index.html and set
   AUDIO.musicFile = "./music.mp3".
   ========================================================= */

export const AUDIO = {
  master: 0.55,
  sfx: 0.8,
  music: 0.32,
  musicFile: null, // e.g. "./music.mp3" — replaces the synth loop
  storageKey: "daud-track-sound",
};

let ctx = null, master, sfxBus, musicBus, noiseBuf;
let enabled = true;
try {
  enabled = localStorage.getItem(AUDIO.storageKey) !== "off";
} catch (_) {}

function init() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = enabled ? AUDIO.master : 0;
  master.connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = AUDIO.sfx;
  sfxBus.connect(master);
  musicBus = ctx.createGain();
  musicBus.gain.value = 0;
  musicBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return true;
}

/** call from a user gesture */
export function unlock() {
  if (!init()) return;
  if (ctx.state === "suspended") ctx.resume();
}

export function isOn() {
  return enabled;
}
export function setOn(v) {
  enabled = v;
  try {
    localStorage.setItem(AUDIO.storageKey, v ? "on" : "off");
  } catch (_) {}
  if (ctx) master.gain.setTargetAtTime(v ? AUDIO.master : 0, ctx.currentTime, 0.05);
}
export function suspend(v) {
  if (!ctx) return;
  if (v) ctx.suspend();
  else ctx.resume();
}

// ---------- tiny synth helpers ----------
function tone({ type = "square", f0, f1 = f0, t = 0, dur = 0.12, vol = 0.3, bus = sfxBus, attack = 0.004 }) {
  if (!ctx) return;
  const now = ctx.currentTime + t;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, now);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(vol, now + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  o.connect(g).connect(bus);
  o.start(now);
  o.stop(now + dur + 0.02);
}
function noise({ t = 0, dur = 0.1, vol = 0.3, hp = 800, lp = 12000, bus = sfxBus }) {
  if (!ctx) return;
  const now = ctx.currentTime + t;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const h = ctx.createBiquadFilter();
  h.type = "highpass";
  h.frequency.value = hp;
  const l = ctx.createBiquadFilter();
  l.type = "lowpass";
  l.frequency.value = lp;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  s.connect(h).connect(l).connect(g).connect(bus);
  s.start(now, Math.random() * 0.3);
  s.stop(now + dur + 0.02);
}

// ---------- sound effects ----------
export const sfx = {
  jump() {
    tone({ type: "square", f0: 330, f1: 760, dur: 0.11, vol: 0.18 });
  },
  land() {
    noise({ dur: 0.05, vol: 0.12, hp: 200, lp: 1800 });
  },
  coffee() {
    tone({ type: "triangle", f0: 988, dur: 0.09, vol: 0.28 });
    tone({ type: "triangle", f0: 1319, t: 0.07, dur: 0.16, vol: 0.28 });
    tone({ type: "sine", f0: 1976, t: 0.07, dur: 0.12, vol: 0.08 });
  },
  ring() {
    // short alarm-bell rattle
    for (let i = 0; i < 6; i++) tone({ type: "triangle", f0: 2093, t: i * 0.03, dur: 0.025, vol: 0.07, attack: 0.002 });
  },
  hundred() {
    tone({ type: "square", f0: 784, dur: 0.06, vol: 0.1 });
    tone({ type: "square", f0: 1175, t: 0.07, dur: 0.09, vol: 0.1 });
  },
  crash() {
    noise({ dur: 0.35, vol: 0.35, hp: 120, lp: 3000 });
    tone({ type: "square", f0: 260, f1: 55, dur: 0.45, vol: 0.2 });
    // pixel crumble
    for (let i = 0; i < 7; i++) tone({ type: "square", f0: 900 - i * 90, t: 0.3 + i * 0.045, dur: 0.04, vol: 0.06 });
  },
  pb() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ type: "square", f0: f, t: 0.55 + i * 0.08, dur: 0.12, vol: 0.12 }));
  },
  start() {
    [392, 523].forEach((f, i) => tone({ type: "square", f0: f, t: i * 0.07, dur: 0.08, vol: 0.12 }));
  },
};

// ---------- music: small chiptune loop that speeds up with the run ----------
// A minor-ish bounce: i – VI – III – VII
const BASS = [45, 45, 57, 45, 41, 41, 53, 41, 48, 48, 60, 48, 43, 43, 55, 43];
const LEAD = [69, 72, 76, 72, 65, 69, 72, 69, 67, 72, 76, 79, 67, 71, 74, 71];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

let playing = false, step = 0, nextT = 0, timer = null, bpm = 120, fileEl = null, fileNode = null;

function schedule() {
  const spb = 60 / bpm / 2; // eighth notes
  while (nextT < ctx.currentTime + 0.12) {
    const i = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const t = nextT - ctx.currentTime;
    tone({ type: "triangle", f0: midi(BASS[i]), t, dur: spb * 0.9, vol: 0.35, bus: musicBus });
    if (bar > 0 || i % 2 === 0) tone({ type: "square", f0: midi(LEAD[(i + bar * 4) % 16] + (bar === 3 ? 12 : 0)), t, dur: spb * 0.55, vol: 0.07, bus: musicBus });
    if (i % 2 === 1) noise({ t, dur: 0.03, vol: 0.12, hp: 7000, bus: musicBus });
    if (i % 4 === 0) tone({ type: "sine", f0: 140, f1: 45, t, dur: 0.12, vol: 0.4, bus: musicBus });
    nextT += spb;
    step++;
  }
}

export function musicStart() {
  if (!ctx) return;
  if (playing) return;
  playing = true;
  musicBus.gain.cancelScheduledValues(ctx.currentTime);
  musicBus.gain.setTargetAtTime(AUDIO.music, ctx.currentTime, 0.15);
  if (AUDIO.musicFile) {
    if (!fileEl) {
      fileEl = new Audio(AUDIO.musicFile);
      fileEl.loop = true;
      fileEl.crossOrigin = "anonymous";
      fileNode = ctx.createMediaElementSource(fileEl);
      fileNode.connect(musicBus);
    }
    fileEl.currentTime = 0;
    fileEl.play().catch(() => {});
    return;
  }
  step = 0;
  nextT = ctx.currentTime + 0.05;
  schedule();
  timer = setInterval(schedule, 25);
}

export function musicStop() {
  if (!ctx || !playing) return;
  playing = false;
  musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
  clearInterval(timer);
  timer = null;
  if (fileEl) setTimeout(() => !playing && fileEl.pause(), 400);
}

/** 0..1 run intensity → tempo */
export function musicIntensity(k) {
  bpm = 118 + k * 46;
  if (fileEl) fileEl.playbackRate = 1 + k * 0.12;
}
