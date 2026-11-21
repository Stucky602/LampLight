// Music made in code (0.9.0, ruling 8): a small step sequencer that plays data/music.js's loops on
// the music bus, crossfading between them, and the ambience bed (the sea's wash and the wind) on
// the ambience bus. The instruments are a few Web Audio voices (VOICES): a tin whistle, a plucked
// string, a fiddle, a drone, a bass, and a bodhran.
//
// The note maths (parsePattern, midiOf, loopNotes) is pure and tested in Node; createMusic needs a
// real AudioContext. Scheduling looks ahead a quarter second on a timer, so a slow frame never
// makes the music stumble. Notes are made as they're scheduled (a few a second: not the sim's
// garbage budget, which this never touches).

import { MUSIC, MODES, AMBIENCE } from '../data/music.js';

/** Split a pattern into tokens, one a step: numbers, '-' (hold), '.' (rest), 'X'/'x' (drum). */
export function parsePattern(pattern) {
  return pattern.split('|').flatMap((bar) => bar.trim().split(/\s+/).filter(Boolean));
}

/** The MIDI note of `degree` in a loop's mode, from its key, `octave` semitones up. */
export function midiOf(loop, degree, octave = 0) {
  const m = MODES[loop.mode];
  if (!m) throw new Error(`music: no mode "${loop.mode}"`);
  const n = m.length, o = Math.floor(degree / n), d = ((degree % n) + n) % n;
  return loop.key + octave + o * 12 + m[d];
}

/** A MIDI note's frequency in Hz. */
export function freqOf(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * Every note a loop plays, in step order: { track, step, midi (null for a drum), vel (a drum's 1 or
 * 0.5, else 1), steps (how many steps it sounds) }. Throws on a token it doesn't know.
 */
export function loopNotes(loop) {
  const out = [];
  loop.tracks.forEach((t, k) => {
    const toks = parsePattern(t.pattern);
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      if (tk === '.' || tk === '-') continue;
      let len = 1;
      while (i + len < toks.length && toks[i + len] === '-') len++;
      if (tk === 'X' || tk === 'x') { out.push({ track: k, step: i, midi: null, vel: tk === 'X' ? 1 : 0.5, steps: 1 }); continue; }
      const deg = Number(tk);
      if (!Number.isInteger(deg)) throw new Error(`music: "${tk}" isn't a step (track ${k})`);
      out.push({ track: k, step: i, midi: midiOf(loop, deg, t.octave), vel: 1, steps: len });
    }
  });
  return out.sort((a, b) => a.step - b.step || a.track - b.track);
}

/** How many steps a loop runs before it repeats (its longest track). */
export function loopSteps(loop) {
  return Math.max(...loop.tracks.map((t) => parsePattern(t.pattern).length));
}

/**
 * The music for where the player is (app: once a frame): the harbor's loop at the title and in the
 * harbor, a run's, and a boss's while one is alive; none anywhere else.
 */
export function musicFor(scene, world) {
  if (scene === 'title' || scene === 'hub') return 'harbor';
  if (scene !== 'run' || !world) return null;
  for (const b of world.bosses || []) if (b.alive) return 'boss';
  return 'run';
}

// ---------------------------------------------------------------- the instruments

/**
 * One note on a voice, at `t` (AudioContext time) for `dur` seconds, into `out` at `gain`. Each
 * voice is a short chain of nodes made for the note and let go when it ends.
 */
export const VOICES = Object.freeze({
  // A tin whistle: a sine with a breath of triangle over it, a soft start, vibrato that comes in late.
  whistle(ctx, out, t, dur, f, gain) {
    const g = ctx.createGain(), o = ctx.createOscillator(), o2 = ctx.createOscillator(), g2 = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f; o2.type = 'triangle'; o2.frequency.value = f; g2.gain.value = 0.25;
    const vib = ctx.createOscillator(), vg = ctx.createGain();
    vib.frequency.value = 5.5; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(0.35, dur));
    vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
    env(g.gain, t, dur, 0.05, 0.15, 0.16 * gain);
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(out);
    for (const n of [o, o2, vib]) { n.start(t); n.stop(t + dur + 0.2); }
  },
  // A plucked string (a bouzouki): a triangle that dies away, its brightness with it.
  pluck(ctx, out, t, dur, f, gain) {
    const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.6);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13 * gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(lp); lp.connect(g); g.connect(out);
    o.start(t); o.stop(t + 1);
  },
  // A fiddle: a sawtooth through a warm filter, bowed in, with vibrato.
  fiddle(ctx, out, t, dur, f, gain) {
    const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = f;
    lp.type = 'lowpass'; lp.frequency.value = 1700; lp.Q.value = 1.2;
    const vib = ctx.createOscillator(), vg = ctx.createGain();
    vib.frequency.value = 6; vg.gain.value = f * 0.008; vib.connect(vg); vg.connect(o.frequency);
    env(g.gain, t, dur, 0.04, 0.08, 0.07 * gain);
    o.connect(lp); lp.connect(g); g.connect(out);
    for (const n of [o, vib]) { n.start(t); n.stop(t + dur + 0.15); }
  },
  // A drone: the note and its fifth, two saws a hair apart, low and dark, swelling in.
  drone(ctx, out, t, dur, f, gain) {
    const lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 520;
    env(g.gain, t, dur, 0.4, 0.4, 0.045 * gain);
    const oscs = [[f, -4], [f, 4], [f * 1.5, 0]].map(([fr, cents]) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = cents; o.connect(lp); return o; });
    lp.connect(g); g.connect(out);
    for (const o of oscs) { o.start(t); o.stop(t + dur + 0.5); }
  },
  // A bass: a round triangle, struck and held.
  bass(ctx, out, t, dur, f, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    env(g.gain, t, dur, 0.01, 0.08, 0.2 * gain);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.12);
  },
  // A bodhran: a low skin thump (a sine dropping fast) with the tipper's tap on it.
  drum(ctx, out, t, dur, f, gain, vel = 1, noise = null) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(52, t + 0.12);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * gain * vel, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.3);
    if (noise) {
      const n = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), ng = ctx.createGain();
      n.buffer = noise; lp.type = 'lowpass'; lp.frequency.value = 1400;
      ng.gain.setValueAtTime(0.12 * gain * vel, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      n.connect(lp); lp.connect(ng); ng.connect(out); n.start(t); n.stop(t + 0.06);
    }
  },
});

/** An attack, hold, and release on a gain: up over `a`, held, down over `r` after `dur`. */
function env(param, t, dur, a, r, peak) {
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(peak, t + Math.min(a, dur * 0.8 + 0.01));
  param.setValueAtTime(peak, t + Math.max(a, dur));
  param.linearRampToValueAtTime(0.0001, t + Math.max(a, dur) + r);
}

function noiseBuffer(ctx, seconds) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  let s = 0x2545f491;
  for (let i = 0; i < n; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; d[i] = ((s >>> 0) / 4294967296) * 2 - 1; }
  return buf;
}

// ---------------------------------------------------------------- the player

const LOOKAHEAD = 0.25, TICK_MS = 60, FADE = 1.6;

/**
 * @param {AudioContext} ctx
 * @param {AudioNode} musicBus, ambienceBus
 * @param {object} [o] loops (data/music.js MUSIC), ambience (AMBIENCE), setTimer/clearTimer (tests)
 */
export function createMusic(ctx, musicBus, ambienceBus, { loops = MUSIC, ambience = AMBIENCE, setTimer = setInterval, clearTimer = clearInterval } = {}) {
  const noise = noiseBuffer(ctx, 2);
  const prepared = {};
  for (const [k, loop] of Object.entries(loops)) prepared[k] = { loop, notes: loopNotes(loop), steps: loopSteps(loop) };
  let current = null;            // { kind, gain, start, next (the next step to schedule) }
  const fading = [];
  let timer = null;

  // The ambience bed: one long noise loop through two chains, always running, its level faded.
  const bed = ctx.createGain(); bed.gain.value = 0; bed.connect(ambienceBus);
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 4); src.loop = true;
  const seaLp = ctx.createBiquadFilter(); seaLp.type = 'lowpass'; seaLp.frequency.value = ambience.sea.cutoff;
  const seaG = ctx.createGain(); seaG.gain.value = ambience.sea.gain * 0.6;
  const seaLfo = ctx.createOscillator(), seaDepth = ctx.createGain();
  seaLfo.frequency.value = 1 / ambience.sea.seaSec; seaDepth.gain.value = ambience.sea.gain * 0.4;
  seaLfo.connect(seaDepth); seaDepth.connect(seaG.gain);
  const windBp = ctx.createBiquadFilter(); windBp.type = 'bandpass'; windBp.frequency.value = ambience.wind.center; windBp.Q.value = ambience.wind.q;
  const windLfo = ctx.createOscillator(), windDepth = ctx.createGain();
  windLfo.frequency.value = 1 / ambience.wind.windSec; windDepth.gain.value = ambience.wind.wander;
  windLfo.connect(windDepth); windDepth.connect(windBp.frequency);
  const windG = ctx.createGain(); windG.gain.value = ambience.wind.gain;
  src.connect(seaLp); seaLp.connect(seaG); seaG.connect(bed);
  src.connect(windBp); windBp.connect(windG); windG.connect(bed);
  let bedOn = false;

  function schedule() {
    const until = ctx.currentTime + LOOKAHEAD;
    for (const p of [current, ...fading]) {
      if (!p) continue;
      const P = prepared[p.kind], L = P.loop;
      while (p.start + p.next * L.step < until) {
        const step = p.next % P.steps, t = p.start + p.next * L.step;
        for (const n of P.notes) {
          if (n.step !== step) continue;
          const tr = L.tracks[n.track], voice = VOICES[tr.voice];
          if (!voice) continue;
          if (n.midi === null) voice(ctx, p.gain, t, L.step, 0, tr.gain, n.vel, noise);
          else voice(ctx, p.gain, t, n.steps * L.step, freqOf(n.midi), tr.gain);
        }
        p.next++;
      }
    }
    for (let k = fading.length - 1; k >= 0; k--) if (ctx.currentTime > fading[k].endAt) { fading[k].gain.disconnect(); fading.splice(k, 1); }
  }

  const api = {
    /** Play a loop ('harbor', 'run', 'boss') or none (null); a change crossfades. */
    set(kind) {
      const k = kind && prepared[kind] ? kind : null;
      if ((current?.kind ?? null) === k) return;
      const now = ctx.currentTime;
      if (current) {
        current.gain.gain.cancelScheduledValues(now);
        current.gain.gain.setValueAtTime(current.gain.gain.value, now);
        current.gain.gain.linearRampToValueAtTime(0.0001, now + FADE);
        current.endAt = now + FADE + 0.1;
        fading.push(current);
        current = null;
      }
      if (k) {
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(1, now + FADE); g.connect(musicBus);
        current = { kind: k, gain: g, start: now + 0.05, next: 0, endAt: Infinity };
      }
      // The bed: on with any music, lower under a boss.
      const level = k === null ? 0 : k === 'boss' ? ambience.bossDuck : 1;
      if (!bedOn && level > 0) { src.start(); seaLfo.start(); windLfo.start(); bedOn = true; }
      bed.gain.cancelScheduledValues(now);
      bed.gain.setValueAtTime(bed.gain.value, now);
      bed.gain.linearRampToValueAtTime(level, now + ambience.fadeSec);
      if (timer === null) timer = setTimer(schedule, TICK_MS);
      schedule();
    },
    get playing() { return current?.kind ?? null; },
    stop() { api.set(null); if (timer !== null) { clearTimer(timer); timer = null; } },
  };
  return api;
}
