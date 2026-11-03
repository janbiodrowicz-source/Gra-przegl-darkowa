/**
 * Sound effects synthesised with WebAudio — no audio files.
 * The context is created on the first user gesture (autoplay policy),
 * suspended while the tab is hidden and muted during ads.
 */

let ctx = null;
let master = null;
let noiseBuffer = null;
let enabled = true;
let muted = false;          // temporary mute (ads)
const VOLUME = 0.55;
const lastPlayed = new Map();

function createContext() {
  if (ctx) return;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return;
  try {
    ctx = new AC();
  } catch {
    ctx = null;
    return;
  }
  master = ctx.createGain();
  master.gain.value = enabled && !muted ? VOLUME : 0;
  // Gentle compression keeps stacked sounds from clipping.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  const len = Math.floor(ctx.sampleRate * 0.6);
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
}

function unlock() {
  createContext();
  if (ctx && ctx.state === 'suspended' && enabled) ctx.resume().catch(() => {});
}

function applyGain() {
  if (!master || !ctx) return;
  master.gain.setTargetAtTime(enabled && !muted ? VOLUME : 0, ctx.currentTime, 0.03);
}

export function initAudio({ enabled: on = true } = {}) {
  enabled = on;
  const opts = { capture: true, passive: true };
  const handler = () => {
    unlock();
    if (ctx) {
      window.removeEventListener('pointerdown', handler, opts);
      window.removeEventListener('keydown', handler, opts);
    }
  };
  window.addEventListener('pointerdown', handler, opts);
  window.addEventListener('keydown', handler, opts);
}

export function setSoundEnabled(on) {
  enabled = !!on;
  if (enabled) unlock();
  applyGain();
}

export function isSoundEnabled() {
  return enabled;
}

/** Temporary mute (e.g. during an ad). */
export function setMuted(on) {
  muted = !!on;
  applyGain();
}

export function suspendAudio() {
  if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended' && enabled) ctx.resume().catch(() => {});
}

/* ---------------- synthesis primitives ---------------- */

const jitter = (amount = 0.04) => 1 + (Math.random() * 2 - 1) * amount;

function ready(name, gapMs) {
  if (!ctx || !enabled || muted || ctx.state !== 'running') return false;
  const now = performance.now();
  if (gapMs && now - (lastPlayed.get(name) || 0) < gapMs) return false;
  lastPlayed.set(name, now);
  return true;
}

function tone({ type = 'sine', freq = 440, to = null, at = 0, dur = 0.15, vol = 0.25, attack = 0.006 }) {
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function noise({ at = 0, dur = 0.2, vol = 0.25, type = 'lowpass', freq = 1200, q = 0.8, to = null }) {
  const t0 = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t0);
  if (to) filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t0, Math.random() * 0.3);
  src.stop(t0 + dur + 0.03);
}

/* ---------------- the palette ---------------- */

export const sfx = {
  click() {
    if (!ready('click', 40)) return;
    tone({ type: 'triangle', freq: 720 * jitter(), dur: 0.06, vol: 0.14 });
  },
  select() {
    if (!ready('select', 50)) return;
    tone({ type: 'sine', freq: 520 * jitter(), to: 780, dur: 0.09, vol: 0.16 });
  },
  tick() {
    if (!ready('tick', 35)) return;
    tone({ type: 'sine', freq: 1100 * jitter(0.08), dur: 0.035, vol: 0.06 });
  },
  build() {
    if (!ready('build', 80)) return;
    noise({ dur: 0.16, vol: 0.28, freq: 900, to: 300 });
    tone({ type: 'sine', freq: 190 * jitter(), to: 85, dur: 0.24, vol: 0.42 });
    tone({ type: 'triangle', freq: 523, at: 0.09, dur: 0.12, vol: 0.12 });
    tone({ type: 'triangle', freq: 784, at: 0.16, dur: 0.16, vol: 0.1 });
  },
  upgrade() {
    if (!ready('upgrade', 120)) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone({ type: 'triangle', freq: f, at: i * 0.07, dur: 0.2, vol: 0.18 }));
    tone({ type: 'sine', freq: 2093, at: 0.3, dur: 0.25, vol: 0.05 });
  },
  coin() {
    if (!ready('coin', 70)) return;
    tone({ type: 'square', freq: 987.77, dur: 0.07, vol: 0.06 });
    tone({ type: 'square', freq: 1318.5, at: 0.065, dur: 0.2, vol: 0.06 });
  },
  quest() {
    if (!ready('quest', 300)) return;
    const notes = [523.25, 659.25, 783.99, 659.25, 1046.5];
    notes.forEach((f, i) => tone({ type: 'triangle', freq: f, at: i * 0.09, dur: i === notes.length - 1 ? 0.45 : 0.14, vol: 0.2 }));
    tone({ type: 'sine', freq: 261.63, at: 0.36, dur: 0.5, vol: 0.12 });
  },
  questReady() {
    if (!ready('questReady', 400)) return;
    tone({ type: 'sine', freq: 880, dur: 0.12, vol: 0.14 });
    tone({ type: 'sine', freq: 1174.7, at: 0.1, dur: 0.22, vol: 0.14 });
  },
  error() {
    if (!ready('error', 150)) return;
    tone({ type: 'triangle', freq: 300, to: 200, dur: 0.12, vol: 0.18 });
    tone({ type: 'triangle', freq: 220, to: 150, at: 0.1, dur: 0.16, vol: 0.16 });
  },
  demolish() {
    if (!ready('demolish', 150)) return;
    noise({ dur: 0.5, vol: 0.4, freq: 700, to: 120 });
    tone({ type: 'sine', freq: 130, to: 48, dur: 0.4, vol: 0.38 });
  },
  chop() {
    if (!ready('chop', 70)) return;
    noise({ dur: 0.07, vol: 0.35, type: 'bandpass', freq: 2400 * jitter(0.1), q: 1.2 });
    tone({ type: 'triangle', freq: 320 * jitter(), to: 190, dur: 0.1, vol: 0.22 });
    noise({ at: 0.1, dur: 0.35, vol: 0.12, freq: 3000, to: 700 });
  },
  crack() {
    if (!ready('crack', 70)) return;
    noise({ dur: 0.12, vol: 0.4, type: 'bandpass', freq: 1500 * jitter(0.1), q: 0.9 });
    tone({ type: 'square', freq: 140, to: 70, dur: 0.12, vol: 0.12 });
  },
  open() {
    if (!ready('open', 60)) return;
    tone({ type: 'sine', freq: 420, to: 640, dur: 0.12, vol: 0.12 });
  },
  close() {
    if (!ready('close', 60)) return;
    tone({ type: 'sine', freq: 600, to: 400, dur: 0.1, vol: 0.1 });
  },
  warn() {
    if (!ready('warn', 600)) return;
    tone({ type: 'sine', freq: 440, dur: 0.14, vol: 0.14 });
    tone({ type: 'sine', freq: 349.2, at: 0.15, dur: 0.22, vol: 0.14 });
  },
};
