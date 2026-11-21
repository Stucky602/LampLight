// The music (0.9.0, ruling 8: made in code, no outside files): three loops, the harbor's, a run's,
// and a boss's, played by audio/music.js on the music bus, and the ambience bed (the sea's wash and
// the wind) on the ambience bus. The mood is folk-dark: a slow air on a whistle over a drone in the
// harbor, a jig on fiddle and bodhran in a run, a Phrygian stamp under a boss. Kevin tunes these by
// name ("the run's fiddle quieter", "the harbor slower").
//
// A loop: key (MIDI note of degree 0), mode (the scale's semitones), step (seconds a step), bar
// (steps a bar), and tracks. A track: voice (audio/music.js VOICES), octave (added to the key),
// gain, and its pattern: tokens split by spaces, bars by '|'. A number is a degree of the mode (0
// the key note; negative goes below, 7 is the octave); '-' holds the note before it a step longer;
// '.' is a rest. A drum track's tokens are 'X' (a full stroke), 'x' (a light one), or '.'.

export const MODES = Object.freeze({
  aeolian: Object.freeze([0, 2, 3, 5, 7, 8, 10]),
  dorian: Object.freeze([0, 2, 3, 5, 7, 9, 10]),
  phrygian: Object.freeze([0, 1, 3, 5, 7, 8, 10]),
});

/** A part, then a second (or the same again): a tune's A and B. */
const twice = (a, b = a) => `${a} | ${b}`;

export const MUSIC = Object.freeze({
  // The harbor at night: a slow air in D minor, 6/8, on a whistle over a drone and a plucked
  // bouzouki. Dm Dm C Dm | Bb Gm C Dm.
  harbor: Object.freeze({
    key: 62, mode: 'aeolian', step: 0.42, bar: 6,
    tracks: Object.freeze([
      { voice: 'whistle', octave: 12, gain: 0.8, pattern: '0 - - 2 - 3 | 4 - - 3 - 2 | 0 - - -1 - 0 | 2 - - - - . | 4 - - 5 - 4 | 3 - - 2 - 0 | 1 - - -1 - -2 | 0 - - - - .' },
      { voice: 'pluck', octave: 0, gain: 0.8, pattern: '0 . 2 . 4 2 | 0 . 2 . 4 2 | -1 . 1 . 3 1 | 0 . 2 . 4 2 | -2 . 0 . 2 0 | -4 . -2 . 0 -2 | -1 . 1 . 3 1 | 0 . 2 . 4 .' },
      { voice: 'drone', octave: -12, gain: 0.9, pattern: '0 - - - - - | 0 - - - - - | -1 - - - - - | 0 - - - - - | -2 - - - - - | -4 - - - - - | -1 - - - - - | 0 - - - - -' },
    ]),
  }),
  // A run: a jig in D dorian, 6/8, fiddle over bodhran and bass, the raised sixth (B) giving the G
  // major its lift. Two parts, as a jig has (A then B, each 8 bars): Dm C G Dm | Dm C G Am, twice.
  run: Object.freeze({
    key: 62, mode: 'dorian', step: 0.2, bar: 6,
    tracks: Object.freeze([
      { voice: 'fiddle', octave: 0, gain: 0.75, pattern: twice(
        '0 2 4 7 4 2 | -1 1 3 6 3 1 | 3 5 7 9 7 5 | 4 2 0 2 - . | 7 - 6 4 - 2 | 3 - 1 -1 - . | 3 5 7 9 7 5 | 4 - - 4 . .',
        '7 6 4 2 4 6 | 7 - - 9 - 7 | 5 4 3 5 7 9 | 7 - 6 4 - . | 2 4 6 7 6 4 | 3 1 -1 1 3 4 | 5 7 5 4 3 1 | 0 - - 0 . .') },
      { voice: 'bass', octave: -24, gain: 0.9, pattern: twice('0 . . 0 . . | -1 . . -1 . . | 3 . . 3 . . | 0 . . 0 . . | 0 . . 0 . . | -1 . . -1 . . | 3 . . 3 . . | 4 . . 4 . .') },
      { voice: 'drum', octave: 0, gain: 0.9, pattern: twice('X . x X . x | X . x X x x | X . x X . x | X . x X x x | X . x X . x | X . x X x x | X . x X . x | X x x X x x') },
      { voice: 'drone', octave: -12, gain: 0.5, pattern: twice('0 - - - - - | -1 - - - - - | 3 - - - - - | 0 - - - - - | 0 - - - - - | -1 - - - - - | 3 - - - - - | 4 - - - - -') },
    ]),
  }),
  // A boss: D Phrygian, 4/4, the flat second (E flat) pressing on the key; a stamping drum, a bass
  // ostinato, the fiddle in long, high, falling lines.
  boss: Object.freeze({
    key: 62, mode: 'phrygian', step: 0.14, bar: 8,
    tracks: Object.freeze([
      { voice: 'fiddle', octave: 0, gain: 0.7, pattern: '7 - - - 6 - 5 - | 8 - - - 7 - 5 - | 7 - - - 6 - 4 - | 5 - 4 - 1 - - - | 7 - - - 6 - 5 - | 8 - - - 9 - 8 - | 7 - 5 - 4 - 3 - | 1 - - - 0 - - -' },
      { voice: 'bass', octave: -24, gain: 1, pattern: '0 . 0 0 1 . 0 . | 0 . 0 0 1 . 0 . | 0 . 0 0 1 . 0 . | -2 . -2 -2 -1 . -2 . | 0 . 0 0 1 . 0 . | 0 . 0 0 1 . 0 . | 0 . 0 0 1 . 0 . | 1 . 1 1 0 . 0 .' },
      { voice: 'drum', octave: 0, gain: 1, pattern: 'X . x . X x x . | X . x . X x x . | X . x . X x x . | X x X x X x X x | X . x . X x x . | X . x . X x x . | X . x . X x x . | X x x x X X X .' },
      { voice: 'drone', octave: -12, gain: 0.7, pattern: '0 - - - - - - - | 0 - - - - - - - | 0 - - - - - - - | -2 - - - - - - - | 0 - - - - - - - | 0 - - - - - - - | 0 - - - - - - - | 1 - - - - - - -' },
    ]),
  }),
});

/**
 * The ambience bed: the sea's wash (noise through a low filter, swelling and ebbing every
 * `seaSec`) and the wind (noise through a band that wanders every `windSec`). `bossDuck`: the bed's
 * level while a boss is up (the fight has the room), `fadeSec`: how long a change takes.
 */
export const AMBIENCE = Object.freeze({
  sea: Object.freeze({ gain: 0.5, cutoff: 420, seaSec: 9 }),
  wind: Object.freeze({ gain: 0.18, center: 700, wander: 350, q: 0.8, windSec: 17 }),
  bossDuck: 0.4,
  fadeSec: 2,
});
