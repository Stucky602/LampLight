// The feel toolkit's arithmetic (render/feel.js), HUD text, and the audio voice rules: the parts
// of rendering and sound that can be checked without a screen or speakers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packColor, createShake, createNumbers, createParticles, fadeOut } from '../src/render/feel.js';
import { formatClock, formatCount } from '../src/render/hudtext.js';
import { createVoiceLimiter, createPitchClimb, createAudio } from '../src/audio/audio.js';
import { zzfxSamples } from '../src/audio/zzfx.js';
import { SFX, SFX_VOICE_CAP } from '../src/data/sfx.js';

test('packColor: RGB and alpha in the byte order Pixi uploads (ABGR)', () => {
  assert.equal(packColor(0xff0000, 1) >>> 0, 0xff0000ff);
  assert.equal(packColor(0x00ff00, 1) >>> 0, 0xff00ff00);
  assert.equal(packColor(0x0000ff, 0) >>> 0, 0x00ff0000);
  assert.equal(packColor(0x123456, 0.5) >>> 24, 127);
  assert.equal(packColor(0xffffff, 7) >>> 24, 255, 'alpha is clamped');
  assert.equal(packColor(0xffffff, -1) >>> 24, 0);
});

test('shake: trauma adds up to 1, decays linearly, and the offset is trauma squared', () => {
  const s = createShake();
  const out = new Float64Array(2);
  s.offsetInto(out, 1.23, 10);
  assert.deepEqual([...out], [0, 0], 'no trauma, no shake');
  s.add(0.5); s.add(0.8);
  assert.equal(s.trauma, 1);
  let worst = 0;
  for (let t = 0; t < 2; t += 0.01) { s.offsetInto(out, t, 10); worst = Math.max(worst, Math.abs(out[0]), Math.abs(out[1])); assert.ok(Number.isInteger(out[0]) && Number.isInteger(out[1]), 'whole pixels'); }
  assert.ok(worst >= 6 && worst <= 10, `full trauma shakes up to maxOffset (${worst})`);
  s.update(0.25, 2);
  assert.equal(s.trauma, 0.5);
  worst = 0;
  for (let t = 0; t < 2; t += 0.01) { s.offsetInto(out, t, 10); worst = Math.max(worst, Math.abs(out[0]), Math.abs(out[1])); }
  assert.ok(worst <= 3, `half trauma is a quarter of the shake (${worst})`);
  s.update(10, 2);
  assert.equal(s.trauma, 0);
  s.add(-1);
  assert.equal(s.trauma, 0, 'negative trauma is ignored');
});

test('damage numbers: hits on one enemy group, a new enemy in the same slot starts fresh, and the cap holds', () => {
  const n = createNumbers(4, 16);
  const a = n.hit(3, 100, 10, 10, 5, 0, 0, 130);
  assert.equal(n.hit(3, 100, 12, 10, 7, 1, 50, 130), a, 'grouped');
  assert.equal(n.value[a], 12);
  assert.equal(n.kind[a], 1, 'a critical hit turns the group critical');
  assert.equal(n.hit(3, 100, 12, 10, 1, 0, 300, 130) !== a, true, 'too late to group: a new number');
  assert.notEqual(n.hit(3, 999, 0, 0, 1, 0, 301, 130), a, 'another enemy in the same slot');
  n.clear();
  for (let k = 0; k < 6; k++) n.hit(k, k, 0, 0, 1, 0, k, 130);
  assert.equal(n.count, 4, 'at most `max` alive; the oldest is replaced');
  const hurt = n.hit(-1, -1, 0, 0, 9, 2, 10, 130);
  assert.equal(n.kind[hurt], 2);
  assert.notEqual(n.hit(-1, -1, 0, 0, 9, 2, 11, 130), hurt, 'player damage never groups');
  n.expire(10000, 620);
  assert.equal(n.count, 0);
});

test('particles: step, fade, remove, and replace the oldest when full', () => {
  const p = createParticles(3);
  p.spawn(0, 0, 100, 0, 1000, 0, 0xffffff, 0, 0);
  p.spawn(0, 0, 0, 0, 100, 0, 0xffffff, 1000, 0);
  p.step(50);
  assert.equal(p.count, 2);
  assert.ok(Math.abs(p.x[0] - 5) < 1e-3, 'moved 100 px/s for 50 ms');
  assert.ok(p.vy[1] > 0, 'gravity pulled the second down');
  p.step(60);
  assert.equal(p.count, 1, 'the short-lived one is gone');
  p.spawn(1, 1, 0, 0, 500, 1, 0, 0, 0); p.spawn(2, 2, 0, 0, 500, 2, 0, 0, 0); p.spawn(3, 3, 0, 0, 500, 3, 0, 0, 0);
  assert.equal(p.count, 3, 'full at capacity; the ring overwrote rather than grew');
  const q = createParticles(2);
  q.spawn(1, 0, 0, 0, 500, 0, 0); q.spawn(2, 0, 0, 0, 500, 0, 0); q.spawn(3, 0, 0, 0, 500, 0, 0);
  assert.deepEqual([q.x[0], q.x[1]], [3, 2], 'the oldest (the first) was the one replaced');
  q.spawn(4, 0, 0, 0, 500, 0, 0);
  assert.deepEqual([q.x[0], q.x[1]], [3, 4], 'then the next oldest');
  assert.equal(fadeOut(0, 100), 1);
  assert.equal(fadeOut(60, 100), 1);
  assert.ok(Math.abs(fadeOut(80, 100) - 0.5) < 1e-9);
  assert.equal(fadeOut(100, 100), 0);
});

test('HUD text: the clock and counts', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(59.9), '0:59');
  assert.equal(formatClock(600), '10:00');
  assert.equal(formatClock(3725), '1:02:05');
  assert.equal(formatClock(NaN), '0:00');
  assert.equal(formatClock(-5), '0:00');
  assert.equal(formatCount(1234567), '1,234,567');
  assert.equal(formatCount(undefined), '0');
});

test('audio: per-sound and global voice caps, and the gem pitch climb', () => {
  const lim = createVoiceLimiter({ hit: 2, gem: 1 }, 3);
  assert.ok(lim.start('hit')); assert.ok(lim.start('hit'));
  assert.equal(lim.start('hit'), false, 'the third hit is dropped');
  assert.ok(lim.start('gem'));
  assert.equal(lim.start('other'), false, 'the global cap');
  lim.end('hit');
  assert.ok(lim.start('other'), 'a finished voice frees room');
  lim.end('nothing');
  assert.equal(lim.total, 3, 'ending a sound that is not playing changes nothing');
  const climb = createPitchClimb(300, 3);
  assert.equal(climb.next(0), 1);
  assert.ok(climb.next(100) > 1);
  climb.next(200); climb.next(300);
  assert.equal(climb.step, 3, 'capped');
  assert.equal(climb.next(1000), 1, 'resets after a pause');
});

test('audio: every sound in data renders to finite samples of a sane length, under the global cap', () => {
  assert.equal(SFX_VOICE_CAP, 24);
  for (const [name, def] of Object.entries(SFX)) {
    const s = zzfxSamples(def.zzfx, 22050);
    assert.ok(s.length > 100 && s.length < 22050 * 3, `${name}: ${s.length} samples`);
    let peak = 0;
    for (const v of s) { assert.ok(Number.isFinite(v), `${name} is finite`); peak = Math.max(peak, Math.abs(v)); }
    assert.ok(peak > 0.01 && peak <= 1.5, `${name} is audible and not clipping wildly (${peak.toFixed(2)})`);
    assert.ok(Number.isInteger(def.voices) && def.voices >= 1 && def.voices <= 4, `${name} voices`);
  }
  assert.ok(SFX.hit_soft.voices <= 4 && SFX.gem.voices === 1, 'hits 4, the gem 1 (§9)');
});

/** A stand-in for Web Audio: enough of an AudioContext to play buffers, and to finish them. */
function fakeAudio({ state = 'running', throws = false } = {}) {
  const started = [];
  class Node { constructor() { this.gain = { value: 1 }; this.pan = { value: 0 }; this.playbackRate = { value: 1 }; } connect(n) { return n; } disconnect() {} }
  class Ctx {
    constructor() { if (throws) throw new Error('no device'); this.state = state; this.sampleRate = 8000; this.destination = new Node(); }
    createGain() { return new Node(); }
    createStereoPanner() { const n = new Node(); n.isPanner = true; return n; }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
    createBufferSource() { const n = new Node(); n.start = () => started.push(n); return n; }
    resume() { this.state = 'running'; return Promise.resolve(); }
  }
  return { win: { AudioContext: Ctx }, started };
}

test('audio: play() respects the caps, frees a voice when it ends, and only the gem climbs', () => {
  const { win, started } = fakeAudio();
  let t = 0;
  const sfx = { hit: { zzfx: [0.5, 0, 200, 0, 0.01, 0.02], voices: 2, pitch: 0.1 }, gem: { zzfx: [0.3, 0, 900, 0, 0, 0.02], voices: 1, pitch: 0 }, beep: { zzfx: [0.3, 0, 900, 0, 0, 0.02], voices: 3, gapMs: 100 } };
  const a = createAudio({ sfx, voiceCap: 24, win, now: () => t, feel: () => ({ vacuum: { pitchStepMs: 300, pitchSteps: 2 } }) });
  assert.equal(a.ok, true);
  assert.ok(a.play('hit', 0.5)); assert.ok(a.play('hit'));
  assert.equal(a.play('hit'), false, 'two voices of hit at most');
  started[0].onended();
  assert.ok(a.play('hit'), 'a finished voice makes room');
  for (const s of started) { const r = s.playbackRate.value; assert.ok(r >= 0.9 && r <= 1.1, `pitch spread stays within 10% (${r})`); }
  assert.ok(a.play('gem'));
  const first = started.at(-1).playbackRate.value;
  started.at(-1).onended(); t += 100;
  a.play('gem');
  assert.ok(started.at(-1).playbackRate.value > first, 'gems close together climb');
  started.at(-1).onended(); t += 100; a.play('gem'); started.at(-1).onended(); t += 100; a.play('gem');
  assert.ok(Math.abs(started.at(-1).playbackRate.value - 2 ** (2 / 12)) < 1e-9, 'the climb stops at the tuned step count');
  assert.ok(a.play('beep'));
  assert.equal(a.play('beep'), false, 'inside its gap');
  t += 150;
  assert.ok(a.play('beep'));
  assert.equal(a.play('nope'), false);
});

test('audio: silent (never throwing) with no Web Audio, no device, or before the first click', () => {
  assert.equal(createAudio({ sfx: {}, voiceCap: 24, win: {} }).ok, false);
  const broken = createAudio({ sfx: {}, voiceCap: 24, win: fakeAudio({ throws: true }).win });
  assert.equal(broken.ok, false);
  broken.play('x'); broken.unlock(); broken.setVolumes({});
  const { win, started } = fakeAudio({ state: 'suspended' });
  const a = createAudio({ sfx: { hit: { zzfx: [0.5, 0, 200, 0, 0.01, 0.02], voices: 2 } }, voiceCap: 24, win });
  assert.equal(a.play('hit'), false, 'suspended: nothing plays');
  assert.equal(started.length, 0);
});
