/**
 * Draws the Android launcher icons from the same maths as the web icons.
 *
 *   node make-app-icons.js
 *
 * Writes ic_launcher / ic_launcher_round / ic_launcher_foreground and the
 * matching background plate into every mipmap density. The foreground layer is
 * drawn at the 108dp adaptive-icon grid, so the drop occupies the inner 72dp
 * safe zone and Android's mask can crop it without clipping.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ------------------------------------------------------------ PNG encoding --

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const at = y * (width * 4 + 1);
    raw[at] = 0;
    rgba.copy(raw, at + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- geometry --

const NAVY = [11, 79, 108];

function lerp(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Convex hull of a point and a circle: straight sides, then the circle. */
function dropHalfWidth(y, cx, apex, cy, R) {
  const d = cy - apex;
  if (y <= apex || y >= cy + R) return 0;
  const slant = Math.sqrt(d * d - R * R);
  const yTangent = cy - (R * R) / d;
  if (y <= yTangent) return (R * (y - apex)) / slant;
  const inside = R * R - (y - cy) * (y - cy);
  return inside <= 0 ? 0 : Math.sqrt(inside);
}

/**
 * Renders the launcher icon.
 *
 * @param size  output pixels
 * @param inset fraction of the canvas the artwork is inset by. Legacy square
 *              icons need ~0; the adaptive foreground needs the 108dp grid's
 *              safe zone, so its artwork is much smaller.
 * @param plate draw the navy background (true) or leave it transparent (false,
 *              for the adaptive foreground layer).
 */
function renderIcon(size, inset, plate) {
  const SS = 4;
  const buf = Buffer.alloc(size * size * 4);
  const scale = 1 - 2 * inset;
  const cx = 0.5;
  const apex = 0.5 - 0.205 * scale;
  const cy = 0.5 + 0.085 * scale;
  const R = 0.212 * scale;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;

          let col = NAVY;
          let alpha = plate ? 255 : 0;

          const hw = dropHalfWidth(y, cx, apex, cy, R);
          if (hw > 0 && Math.abs(x - cx) <= hw) {
            col = lerp([127, 212, 245], [27, 127, 181], Math.min(1, (y - apex) / (0.42 * scale)));
            const dx = (x - 0.437) / (0.059 * scale);
            const dy = (y - (cy - 0.019 * scale)) / (0.086 * scale);
            if (dx * dx + dy * dy <= 1) col = lerp(col, [255, 255, 255], 0.55);
            alpha = 255;
          }

          r += col[0];
          g += col[1];
          b += col[2];
          a += alpha;
        }
      }
      const n = SS * SS;
      const at = (py * size + px) * 4;
      const av = a / n;
      // Straight (un-premultiplied) alpha: a pixel that is half drop, half
      // transparent must keep the drop's colour, not fade toward black.
      const w = av > 0 ? (255 / av) : 0;
      buf[at] = Math.min(255, Math.round((r / n) * w));
      buf[at + 1] = Math.min(255, Math.round((g / n) * w));
      buf[at + 2] = Math.min(255, Math.round((b / n) * w));
      buf[at + 3] = Math.round(av);
    }
  }
  return encodePng(size, size, buf);
}

const res = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');

// Launcher icon size per density bucket, and the adaptive-icon foreground
// size, which is 108dp against the 48dp legacy icon.
const DENSITIES = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
];

for (const [density, legacy, adaptive] of DENSITIES) {
  const dir = path.join(res, `mipmap-${density}`);
  fs.mkdirSync(dir, { recursive: true });

  const square = renderIcon(legacy, 0.06, true);
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), square);
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), square);

  // Adaptive foreground: no plate, artwork inside the safe zone.
  fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), renderIcon(adaptive, 0.29, false));

  // The background layer is a flat colour plate; Android composites it behind.
  const plateBuf = Buffer.alloc(adaptive * adaptive * 4);
  for (let i = 0; i < plateBuf.length; i += 4) {
    plateBuf[i] = NAVY[0];
    plateBuf[i + 1] = NAVY[1];
    plateBuf[i + 2] = NAVY[2];
    plateBuf[i + 3] = 255;
  }
  fs.writeFileSync(path.join(dir, 'ic_launcher_background.png'), encodePng(adaptive, adaptive, plateBuf));

  console.log(`  ${density.padEnd(8)} legacy ${legacy}px  adaptive ${adaptive}px`);
}
console.log('bitti.');