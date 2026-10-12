/**
 * Draws the Farah logo and writes the PNG icons the web panel needs.
 *
 * No image library: the web panel ships with zero dependencies and stays that
 * way, so the icons are rendered here from maths and encoded with Node's own
 * zlib. Running this twice produces byte-identical files, so the icons can be
 * regenerated and committed without a diff.
 *
 *   node make-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------- PNG output

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

/** Encodes raw RGBA pixels as a PNG. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // One filter byte (0 = None) per scanline.
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

// ------------------------------------------------------------------- drawing

const NAVY = [11, 79, 108];

function lerp(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * The drop's half-width at a given y, in 0..1 icon units.
 *
 * The shape is the convex hull of a point and a circle: straight sides from the
 * tip down to where they touch the circle, then the circle itself. Joining a
 * circle to an ellipse cap instead - the obvious first attempt - produces an
 * egg, because both curves meet the same point with a horizontal tangent.
 */
function dropHalfWidth(y) {
  const R = 0.212; // radius of the circular bottom
  const CY = 0.585; // centre of that circle
  const APEX = 0.18; // tip

  const d = CY - APEX; // apex to centre
  const slant = Math.sqrt(d * d - R * R); // where a tangent meets the circle
  const yTangent = CY - (R * R) / d;

  if (y <= APEX) return 0;
  if (y >= CY + R) return 0;

  if (y <= yTangent) {
    return (R * (y - APEX)) / slant;
  }
  const inside = R * R - (y - CY) * (y - CY);
  return inside <= 0 ? 0 : Math.sqrt(inside);
}

/**
 * Renders one icon.
 *
 * Everything is sampled at SS x SS per output pixel and averaged, which is
 * what keeps the diagonal edges of the drop from looking like stairs at 512px.
 */
function render(size) {
  const SS = 4;
  const buf = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;

          // Full bleed: the phone applies its own mask, and a transparent edge
          // would show as a dark fringe on some launchers.
          let col = NAVY;

          const hw = dropHalfWidth(y);
          if (hw > 0 && Math.abs(x - 0.5) <= hw) {
            // Vertical gradient, light at the tip, deep at the base.
            col = lerp([127, 212, 245], [27, 127, 181], Math.min(1, (y - 0.18) / 0.42));

            // Specular highlight: a small ellipse up and to the left.
            const dx = (x - 0.437) / 0.059;
            const dy = (y - 0.566) / 0.086;
            if (dx * dx + dy * dy <= 1) {
              col = lerp(col, [255, 255, 255], 0.55);
            }
          }

          r += col[0]; g += col[1]; b += col[2]; a += 255;
        }
      }

      const n = SS * SS;
      const at = (py * size + px) * 4;
      buf[at] = Math.round(r / n);
      buf[at + 1] = Math.round(g / n);
      buf[at + 2] = Math.round(b / n);
      buf[at + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, size, buf);
}

const outDir = path.join(__dirname, 'assets');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
  ['favicon-32.png', 32],
];

for (const [name, size] of targets) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, render(size));
  console.log(`  ${name.padEnd(24)} ${size}x${size}  ${(fs.statSync(file).size / 1024).toFixed(1)} KB`);
}
console.log('bitti.');