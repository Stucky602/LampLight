// Generates the app icon (a lit lantern on night blue) as PNGs and a multi-size .ico, in code.
// Placeholder until the art pass; the pipeline is what matters here.
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const PALETTE = { night: [13, 16, 24], rim: [38, 47, 66], glass: [255, 217, 138], core: [255, 244, 210], metal: [58, 29, 16], metal2: [107, 52, 19] };

// 16x16 master, drawn as rows; scaled up by whole numbers for the larger sizes.
const ROWS = [
  '................',
  '......mmmm......',
  '.....m....m.....',
  '....MMMMMMMM....',
  '....M.gggg.M....',
  '....MggccggM....',
  '....MgcCCcgM....',
  '....MgcCCcgM....',
  '....MggccggM....',
  '....M.gggg.M....',
  '....MMMMMMMM....',
  '.....MMMMMM.....',
  '......M..M......',
  '................',
  '................',
  '................',
];
const COLORS = { '.': null, m: PALETTE.metal, M: PALETTE.metal2, g: PALETTE.glass, c: PALETTE.core, C: [255, 255, 255] };

function render(size) {
  const png = new PNG({ width: size, height: size });
  const s = size / 16;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const cx = x / s - 8, cy = y / s - 8;
      const glow = Math.max(0, 1 - Math.sqrt(cx * cx + (cy + 1) * (cy + 1)) / 7.5);
      const bg = PALETTE.night.map((v, k) => Math.min(255, Math.round(v + glow * glow * [120, 80, 30][k])));
      const ch = ROWS[Math.floor(y / s)][Math.floor(x / s)];
      const col = COLORS[ch] || bg;
      // Square backdrop with a 1-cell rim.
      const edge = Math.max(Math.abs(cx + 0.5), Math.abs(cy + 0.5));
      const inside = edge < 7.6;
      const rim = edge >= 7.0 && inside;
      const c = !inside ? null : rim ? PALETTE.rim : col;
      png.data[i] = c ? c[0] : 0; png.data[i + 1] = c ? c[1] : 0; png.data[i + 2] = c ? c[2] : 0; png.data[i + 3] = c ? 255 : 0;
    }
  }
  return PNG.sync.write(png);
}

/** ICO container with PNG-compressed entries (supported since Windows Vista). */
function ico(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6 + 16 * count);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const o = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, o);
    header.writeUInt8(size >= 256 ? 0 : size, o + 1);
    header.writeUInt8(0, o + 2); header.writeUInt8(0, o + 3);
    header.writeUInt16LE(1, o + 4); header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(data.length, o + 8); header.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

/** Re-read an .ico and check its directory: count, sizes, offsets inside the file, PNG signatures. */
function checkIco(buf, sizes) {
  const count = buf.readUInt16LE(4);
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1 || count !== sizes.length) throw new Error('icon header is wrong');
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    const w = buf.readUInt8(o) || 256;
    const len = buf.readUInt32LE(o + 8), off = buf.readUInt32LE(o + 12);
    if (w !== sizes[i]) throw new Error(`icon entry ${i} is ${w}px, expected ${sizes[i]}`);
    if (off + len > buf.length) throw new Error(`icon entry ${i} runs past the end of the file`);
    if (buf.readUInt32BE(off) !== 0x89504e47) throw new Error(`icon entry ${i} is not a PNG`);
  }
}

const out = process.argv[2] || 'tools/out/icon/lamplight.ico';
mkdirSync(dirname(out), { recursive: true });
const sizes = [16, 32, 48, 64, 128, 256];
const pngs = sizes.map((size) => ({ size, data: render(size) }));
const icoBuf = ico(pngs);
checkIco(icoBuf, sizes);
writeFileSync(out, icoBuf);
writeFileSync(out.replace(/\.ico$/, '.png'), pngs.at(-1).data);
console.log('icon written:', out);
