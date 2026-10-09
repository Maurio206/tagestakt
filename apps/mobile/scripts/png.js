// @ts-check
/**
 * Minimale PNG-Werkzeuge ohne Fremdpakete (nur node:zlib): RGBA schreiben, lesen und
 * flächengewichtet verkleinern. Genutzt vom Icon-Generator, vom Splash-Plugin und von Tests.
 */
const zlib = require("node:zlib");

/** @typedef {{ width: number, height: number, data: Uint8Array }} RgbaImage */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** @param {Buffer} buffer */
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * RGBA (8 Bit, nicht vormultipliziert) als PNG. Deterministisch: gleiche Pixel → gleiche Bytes.
 * @param {RgbaImage} image
 */
function encodePng({ width, height, data }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // Bittiefe
  header[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // Filter „None“
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** @param {number} a @param {number} b @param {number} c */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Liest 8-Bit-PNGs (RGB oder RGBA, ohne Interlacing) als RGBA.
 * @param {Buffer} buffer
 * @returns {RgbaImage & { colorType: number }}
 */
function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("Keine PNG-Datei");
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      if (data[8] !== 8 || data[12] !== 0 || (colorType !== 6 && colorType !== 2)) {
        throw new Error("Nur 8-Bit-RGB/RGBA ohne Interlacing wird unterstützt");
      }
    } else if (type === "IDAT") {
      idat.push(data);
    }
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      if (predictor === undefined) throw new Error(`Unbekannter PNG-Filter ${filter}`);
      pixels[y * stride + x] = (line[x] + predictor) & 0xff;
    }
  }
  if (channels === 4) return { width, height, colorType, data: new Uint8Array(pixels) };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba.set(pixels.subarray(i * 3, i * 3 + 3), i * 4);
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, colorType, data: rgba };
}

/**
 * Flächengewichtete Verkleinerung (Box-Filter) mit vormultipliziertem Alpha – keine dunklen
 * Säume an transparenten Kanten.
 * @param {RgbaImage} image @param {number} width @param {number} height
 * @returns {RgbaImage}
 */
function resize(image, width, height) {
  /** @param {Float64Array} src @param {number} sw @param {number} sh @param {number} dw @param {boolean} horizontal */
  const pass = (src, sw, sh, dw, horizontal) => {
    const outW = horizontal ? dw : sw;
    const outH = horizontal ? sh : dw;
    const out = new Float64Array(outW * outH * 4);
    const srcLen = horizontal ? sw : sh;
    const scale = srcLen / dw;
    for (let i = 0; i < dw; i += 1) {
      const start = i * scale;
      const end = start + scale;
      for (let s = Math.floor(start); s < Math.min(Math.ceil(end), srcLen); s += 1) {
        const weight = (Math.min(end, s + 1) - Math.max(start, s)) / scale;
        const lines = horizontal ? sh : sw;
        for (let l = 0; l < lines; l += 1) {
          const from = horizontal ? (l * sw + s) * 4 : (s * sw + l) * 4;
          const to = horizontal ? (l * outW + i) * 4 : (i * outW + l) * 4;
          for (let c = 0; c < 4; c += 1) out[to + c] += src[from + c] * weight;
        }
      }
    }
    return out;
  };
  const premultiplied = new Float64Array(image.width * image.height * 4);
  for (let i = 0; i < image.width * image.height; i += 1) {
    const a = image.data[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c += 1) premultiplied[i * 4 + c] = image.data[i * 4 + c] * a;
    premultiplied[i * 4 + 3] = a;
  }
  const h = pass(premultiplied, image.width, image.height, width, true);
  const v = pass(h, width, image.height, height, false);
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const a = v[i * 4 + 3];
    for (let c = 0; c < 3; c += 1) data[i * 4 + c] = a > 0 ? Math.round(v[i * 4 + c] / a) : 0;
    data[i * 4 + 3] = Math.round(a * 255);
  }
  return { width, height, data };
}

module.exports = { encodePng, decodePng, resize };
