// Sound (ARCHITECTURE §9): every effect rendered once at boot from data/sfx.js, played from
// buffers with voice limits, through master, music, and SFX volume buses.
//
// Voice limiting: each sound has its own cap (hits: 4, the gem pickup: 1) and there's a global
// cap of 24. A play over either cap is simply dropped: in a horde game the fifth identical hit
// in a frame adds noise, not information. The gem sound climbs in pitch while pickups keep
// coming close together, and resets after a pause.
//
// Browsers start audio suspended until the first key or click (a gamepad press doesn't count
// in Chromium); Electron is told to allow it from the start. unlock() is safe to call anytime.

import { zzfxSamples } from './zzfx.js';

/**
 * The voice bookkeeping, separate from Web Audio so it can be tested: may this sound start now?
 * start() says yes (and counts it) or no; end() is called when a voice finishes. `gaps` (ms per
 * sound) keeps a sound from restarting too often even when voices are free: a warning beep ten
 * times a second stops meaning anything.
 */
export function createVoiceLimiter(caps, globalCap, gaps = {}) {
  const active = new Map();
  const lastAt = new Map();
  let total = 0;
  return {
    start(name, now = 0) {
      const cap = caps[name] ?? 1;
      const n = active.get(name) || 0;
      if (n >= cap || total >= globalCap) return false;
      const gap = gaps[name] || 0;
      if (gap > 0 && now - (lastAt.get(name) ?? -Infinity) < gap) return false;
      lastAt.set(name, now);
      active.set(name, n + 1);
      total++;
      return true;
    },
    end(name) {
      const n = active.get(name) || 0;
      if (n > 0) { active.set(name, n - 1); total--; }
    },
    get total() { return total; },
    playing(name) { return active.get(name) || 0; },
  };
}

/**
 * The gem pitch climb: a step up per pickup within `windowMs` of the last, up to `steps`. The
 * window and step count can be given per call (the tuning panel changes them live).
 */
export function createPitchClimb(windowMs, steps) {
  let last = -Infinity, step = 0;
  return {
    next(now, w = windowMs, n = steps) {
      step = now - last <= w ? Math.min(n, step + 1) : 0;
      last = now;
      return 2 ** (step / 12); // a semitone per step
    },
    get step() { return step; },
  };
}

const SILENT = Object.freeze({ ok: false, unlock() {}, play() {}, setVolumes() {}, get state() { return 'none'; }, get voices() { return 0; } });

/**
 * @param {object} o
 * @param {()=>object} [o.feel] the live `tuning.feel` (the gem climb reads vacuum.* from it)
 * @param {()=>number} [o.now] ms clock
 */
export function createAudio({ sfx, voiceCap, volumes = { master: 0.8, music: 0.6, sfx: 0.8 }, feel = () => null, win = globalThis, now = () => performance.now() }) {
  const Ctx = win.AudioContext || win.webkitAudioContext;
  // No Web Audio, or no sound device (the constructor throws): play silently. The debug overlay
  // shows the sound state.
  if (!Ctx) return SILENT;
  let ctx;
  try { ctx = new Ctx({ latencyHint: 'interactive' }); } catch { return SILENT; }
  const master = ctx.createGain(), musicBus = ctx.createGain(), sfxBus = ctx.createGain();
  sfxBus.connect(master); musicBus.connect(master); master.connect(ctx.destination);
  const buffers = new Map();
  const caps = {}, gaps = {};
  for (const [name, def] of Object.entries(sfx)) {
    if (def.gapMs) gaps[name] = def.gapMs;
    const samples = zzfxSamples(def.zzfx, ctx.sampleRate);
    const buf = ctx.createBuffer(1, Math.max(1, samples.length), ctx.sampleRate);
    buf.getChannelData(0).set(samples);
    buffers.set(name, buf);
    caps[name] = def.voices ?? 1;
  }
  const limiter = createVoiceLimiter(caps, voiceCap, gaps);
  const gemPitch = createPitchClimb(350, 12);

  function setVolumes(v) {
    master.gain.value = v.master ?? 0.8;
    musicBus.gain.value = v.music ?? 0.6;
    sfxBus.gain.value = v.sfx ?? 0.8;
  }
  setVolumes(volumes);

  return {
    ok: true,
    /** Resume audio after a user gesture (browsers keep it suspended until then). */
    unlock() { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); },
    get state() { return ctx.state; },
    get voices() { return limiter.total; },
    setVolumes,
    /**
     * Play a sound by name, panned (-1 left .. 1 right) and pitched (a multiplier). Unknown names
     * and plays over the voice caps or inside a sound's gap do nothing.
     */
    play(name, pan = 0, pitch = 1) {
      if (ctx.state !== 'running') return false;
      const def = sfx[name], buf = buffers.get(name);
      if (!def || !buf) return false;
      if (!limiter.start(name, now())) return false;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      let rate = pitch;
      if (name === 'gem') {
        const v = feel()?.vacuum;
        rate *= gemPitch.next(now(), v?.pitchStepMs ?? 350, v?.pitchSteps ?? 12);
      }
      if (def.pitch) rate *= 1 + (Math.random() * 2 - 1) * def.pitch;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = def.gain ?? 1;
      let p = null;
      src.connect(g);
      if (pan) {
        p = ctx.createStereoPanner();
        p.pan.value = pan < -1 ? -1 : pan > 1 ? 1 : pan;
        g.connect(p);
        p.connect(sfxBus);
      } else g.connect(sfxBus);
      src.onended = () => { limiter.end(name); src.disconnect(); g.disconnect(); p?.disconnect(); };
      try { src.start(); } catch { limiter.end(name); return false; } // a voice that never started frees its place
      return true;
    },
  };
}
