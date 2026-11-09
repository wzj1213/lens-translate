// Generates the extension's PNG icons (16/32/48/128) with zero dependencies.
//
// A lens and a line of text remain legible at toolbar sizes.

import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";

const SIZES = [16, 32, 48, 128];
const SS = 4; // supersampling factor

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Signed distance to a rounded rectangle centered region (negative = inside).
function roundedRectSDF(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

// Signed distance to a ring (negative = on the stroke).
function ringSDF(px, py, cx, cy, radius, halfStroke) {
  return Math.abs(Math.hypot(px - cx, py - cy) - radius) - halfStroke;
}

function coverage(sdf) {
  // ~1px soft edge in supersampled space.
  return Math.min(1, Math.max(0, 0.5 - sdf));
}

function over(dst, src) {
  // src/dst are [r,g,b,a] with a in 0..1. Returns straight-alpha composite.
  const a = src[3] + dst[3] * (1 - src[3]);
  if (a === 0) return [0, 0, 0, 0];
  const r = (src[0] * src[3] + dst[0] * dst[3] * (1 - src[3])) / a;
  const g = (src[1] * src[3] + dst[1] * dst[3] * (1 - src[3])) / a;
  const b = (src[2] * src[3] + dst[2] * dst[3] * (1 - src[3])) / a;
  return [r, g, b, a];
}

function shade(px, py, W) {
  let out = [0, 0, 0, 0];

  // Tile background (rounded square, vertical teal gradient).
  const tileR = W * 0.24;
  const tileSDF = roundedRectSDF(px, py, W / 2, W / 2, W / 2 - W * 0.02, W / 2 - W * 0.02, tileR);
  const tileA = coverage(tileSDF);
  if (tileA > 0) {
    const t = py / W;
    const top = [0x14, 0xb8, 0xa6];
    const bottom = [0x0f, 0x6f, 0x66];
    out = over(out, [lerp(top[0], bottom[0], t), lerp(top[1], bottom[1], t), lerp(top[2], bottom[2], t), tileA]);
  }

  const cx = W * 0.5;
  const cy = W * 0.465;
  const R = W * 0.275;

  // Two lines inside the lens suggest a source line with its translation.
  const ring = ringSDF(px, py, cx, cy, R, W * 0.04);
  const ringA = coverage(ring);
  if (ringA > 0) out = over(out, [255, 255, 255, ringA]);

  const lineH = W * 0.062;
  const lineR = lineH / 2;

  const top = roundedRectSDF(px, py, cx, cy - W * 0.082, W * 0.125, lineH / 2, lineR);
  const topA = coverage(top);
  if (topA > 0) out = over(out, [255, 255, 255, topA]);

  const hl = roundedRectSDF(px, py, cx, cy + W * 0.082, W * 0.155, lineH / 2, lineR);
  const hlA = coverage(hl);
  if (hlA > 0) out = over(out, [0xff, 0xd9, 0x80, hlA]);

  return out;
}

function renderRGBA(size) {
  const W = size * SS;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x * SS + sx + 0.5;
          const py = y * SS + sy + 0.5;
          const c = shade(px, py, W);
          // Accumulate premultiplied for correct alpha averaging.
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      }
      const n = SS * SS;
      const alpha = a / n;
      const idx = (y * size + x) * 4;
      if (alpha > 0) {
        buf[idx] = Math.round(r / a);
        buf[idx + 1] = Math.round(g / a);
        buf[idx + 2] = Math.round(b / a);
      }
      buf[idx + 3] = Math.round(alpha * 255);
    }
  }
  return buf;
}

// --- Minimal PNG encoder ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(rgba, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // 10..12 default 0
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

async function main() {
  await mkdir("static/icons", { recursive: true });
  for (const size of SIZES) {
    const png = encodePNG(renderRGBA(size), size);
    await writeFile(`static/icons/icon-${size}.png`, png);
    console.log(`[icons] static/icons/icon-${size}.png (${png.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
