// InputFrame: the only thing the simulation knows about the player's hands.
//
// One frame per sim tick: movement quantized to signed 8-bit per axis, plus a button bitmask.
// Live play and replays both feed the sim the SAME quantized values, which is what makes a
// replay reproduce a run exactly. Three bytes per tick; a 20-minute run is 216 KB raw and
// compresses to a few KB (long stretches repeat).

export const BTN_DASH = 1;
export const BTN_ANY = 0xff;
export const FRAME_BYTES = 3;

/** -1..1 to -127..127 (rounded, clamped). NaN becomes 0. */
export function quantizeAxis(v) {
  if (!(v === v)) return 0;
  const c = v < -1 ? -1 : v > 1 ? 1 : v;
  return Math.round(c * 127) | 0; // | 0 turns -0 into 0 so frames compare cleanly
}

/** -127..127 back to -1..1. */
export function dequantizeAxis(q) {
  return q / 127;
}

/** Build a frame from analog movement and buttons. */
export function makeFrame(moveX, moveY, buttons = 0) {
  return { mx: quantizeAxis(moveX), my: quantizeAxis(moveY), buttons: buttons & 0xff };
}

export const EMPTY_FRAME = Object.freeze({ mx: 0, my: 0, buttons: 0 });

/**
 * Movement the sim should apply for a frame: dequantized, with magnitude clamped to 1
 * (quantized keyboard diagonals come out at 1.002).
 */
export function frameMove(frame) {
  let x = frame.mx / 127, y = frame.my / 127;
  const m2 = x * x + y * y;
  if (m2 > 1) { const m = Math.sqrt(m2); x /= m; y /= m; }
  return { x, y };
}

/** Growable recorder for replays. */
export function createFrameRecorder(initialTicks = 3600) {
  let buf = new Uint8Array(Math.max(1, initialTicks) * FRAME_BYTES);
  let count = 0;
  return {
    push(frame) {
      if ((count + 1) * FRAME_BYTES > buf.length) {
        const next = new Uint8Array(buf.length * 2);
        next.set(buf);
        buf = next;
      }
      const o = count * FRAME_BYTES;
      buf[o] = frame.mx & 0xff;       // two's complement in a byte
      buf[o + 1] = frame.my & 0xff;
      buf[o + 2] = frame.buttons & 0xff;
      count++;
    },
    get length() { return count; },
    /** Exactly the recorded bytes (a copy). */
    toBytes() { return buf.slice(0, count * FRAME_BYTES); },
    clear() { count = 0; },
  };
}

/** Read frame `tick` (an integer) from recorded bytes. Outside the recording returns EMPTY_FRAME. */
export function readFrame(bytes, tick) {
  if (!Number.isInteger(tick)) throw new Error(`readFrame needs an integer tick, got ${tick}`);
  const o = tick * FRAME_BYTES;
  if (tick < 0 || o + FRAME_BYTES > bytes.length) return EMPTY_FRAME;
  const sx = bytes[o], sy = bytes[o + 1];
  return { mx: sx > 127 ? sx - 256 : sx, my: sy > 127 ? sy - 256 : sy, buttons: bytes[o + 2] };
}

export function frameCount(bytes) {
  return Math.floor(bytes.length / FRAME_BYTES);
}
