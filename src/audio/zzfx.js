// The ZzFX sample generator (ZzFX v1.3.2 by Frank Force, MIT license, reproduced below), cut
// down to the one function the game needs: turning a sound's parameter list into samples. The
// game renders every sound once at boot and plays the buffers (audio/audio.js); nothing here
// touches an AudioContext. Credited on the credits screen.
//
//   ZzFX MIT License
//   Copyright (c) 2019 - Frank Force
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this
//   software and associated documentation files (the "Software"), to deal in the Software
//   without restriction, including without limitation the rights to use, copy, modify, merge,
//   publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
//   to whom the Software is furnished to do so, subject to the following conditions:
//   The above copyright notice and this permission notice shall be included in all copies or
//   substantial portions of the Software.
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
//   INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
//   PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
//   FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
//   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
//   DEALINGS IN THE SOFTWARE.
//
// Changes from the original: a plain function over a sample rate, frequency randomness left out
// (playback varies pitch instead, per sound), and a Float32Array out.

/**
 * @param {number[]} params the ZzFX parameter list (volume, randomness, frequency, attack,
 *   sustain, release, shape, shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime,
 *   repeatTime, noise, modulation, bitCrush, delay, sustainVolume, decay, tremolo, filter)
 * @param {number} sampleRate
 * @returns {Float32Array}
 */
export function zzfxSamples(params, sampleRate = 44100) {
  let [
    volume = 1, , frequency = 220, attack = 0, sustain = 0, release = 0.1, shape = 0, shapeCurve = 1,
    slide = 0, deltaSlide = 0, pitchJump = 0, pitchJumpTime = 0, repeatTime = 0, noise = 0,
    modulation = 0, bitCrush = 0, delay = 0, sustainVolume = 1, decay = 0, tremolo = 0, filter = 0,
  ] = params.map((v) => (v === null || v === undefined ? undefined : v));
  const PI2 = Math.PI * 2, abs = Math.abs, sign = (v) => (v < 0 ? -1 : 1);
  const startSlide = slide *= 500 * PI2 / sampleRate / sampleRate;
  let startFrequency = frequency *= PI2 / sampleRate;
  let modOffset = 0, repeat = 0, crush = 0, jump = 1, length, t = 0, i = 0, s = 0, f;
  const quality = 2, w = PI2 * abs(filter) * 2 / sampleRate;
  const cos = Math.cos(w), alpha = Math.sin(w) / 2 / quality;
  const a0 = 1 + alpha, a1 = -2 * cos / a0, a2 = (1 - alpha) / a0;
  const b0 = (1 + sign(filter) * cos) / 2 / a0, b1 = -(sign(filter) + cos) / a0, b2 = b0;
  let x2 = 0, x1 = 0, y2 = 0, y1 = 0;
  const minAttack = 9;
  attack = attack * sampleRate || minAttack;
  decay *= sampleRate;
  sustain *= sampleRate;
  release *= sampleRate;
  delay *= sampleRate;
  deltaSlide *= 500 * PI2 / sampleRate ** 3;
  modulation *= PI2 / sampleRate;
  pitchJump *= PI2 / sampleRate;
  pitchJumpTime *= sampleRate;
  repeatTime = repeatTime * sampleRate | 0;
  length = attack + decay + sustain + release + delay | 0;
  const b = new Float32Array(length);
  for (; i < length; b[i++] = s * volume) {
    if (!(++crush % (bitCrush * 100 | 0))) {
      s = shape ? shape > 1 ? shape > 2 ? shape > 3 ? shape > 4
        ? (t / PI2 % 1 < shapeCurve / 2) * 2 - 1
        : Math.sin(t ** 3)
        : Math.max(Math.min(Math.tan(t), 1), -1)
        : 1 - (2 * t / PI2 % 2 + 2) % 2
        : 1 - 4 * abs(Math.round(t / PI2) - t / PI2)
        : Math.sin(t);
      s = (repeatTime ? 1 - tremolo + tremolo * Math.sin(PI2 * i / repeatTime) : 1) *
        (shape > 4 ? s : sign(s) * abs(s) ** shapeCurve) *
        (i < attack ? i / attack
          : i < attack + decay ? 1 - ((i - attack) / decay) * (1 - sustainVolume)
            : i < attack + decay + sustain ? sustainVolume
              : i < length - delay ? (length - i - delay) / release * sustainVolume
                : 0);
      s = delay ? s / 2 + (delay > i ? 0 : (i < length - delay ? 1 : (length - i) / delay) * b[i - delay | 0] / 2 / volume) : s;
      if (filter) s = y1 = b2 * x2 + b1 * (x2 = x1) + b0 * (x1 = s) - a2 * y2 - a1 * (y2 = y1);
    }
    f = (frequency += slide += deltaSlide) * Math.cos(modulation * modOffset++);
    t += f + f * noise * Math.sin(i ** 5);
    if (jump && ++jump > pitchJumpTime) { frequency += pitchJump; startFrequency += pitchJump; jump = 0; }
    if (repeatTime && !(++repeat % repeatTime)) { frequency = startFrequency; slide = startSlide; jump ||= 1; }
  }
  return b;
}
