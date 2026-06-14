const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function makePng(size, rgba) {
  const w = size;
  const h = size;
  const stride = w * 4 + 1;

  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(stride);
    row[0] = 0;
    for (let x = 0; x < w; x++) {
      const dx = x - w / 2;
      const dy = y - h / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const r = w / 2;
      let inCircle = dist <= r - 1;
      let onRing = dist >= r - 1.2 && dist <= r;
      let idx = 1 + x * 4;
      if (onRing) {
        row[idx + 0] = 30;
        row[idx + 1] = 30;
        row[idx + 2] = 30;
        row[idx + 3] = 255;
      } else if (inCircle) {
        row[idx + 0] = rgba[0];
        row[idx + 1] = rgba[1];
        row[idx + 2] = rgba[2];
        row[idx + 3] = rgba[3];
      } else {
        row[idx + 0] = 0;
        row[idx + 1] = 0;
        row[idx + 2] = 0;
        row[idx + 3] = 0;
      }
    }
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const idat = zlib.deflateSync(raw);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  function crc32(buf) {
    let c;
    const table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc = (table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeIco(pngBuf, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const dirEntry = Buffer.alloc(16);
  dirEntry[0] = size === 256 ? 0 : size;
  dirEntry[1] = size === 256 ? 0 : size;
  dirEntry[2] = 0;
  dirEntry[3] = 0;
  dirEntry.writeUInt16LE(1, 4);
  dirEntry.writeUInt16LE(32, 6);
  dirEntry.writeUInt32LE(pngBuf.length, 8);
  dirEntry.writeUInt32LE(6 + 16, 12);
  return Buffer.concat([header, dirEntry, pngBuf]);
}

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });

const idlePng = makePng(32, [90, 170, 240, 255]);
const recordingPng = makePng(32, [231, 76, 60, 255]);

fs.writeFileSync(path.join(outDir, 'tray-idle.png'), idlePng);
fs.writeFileSync(path.join(outDir, 'tray-recording.png'), recordingPng);

const icoPng = makePng(64, [90, 170, 240, 255]);
fs.writeFileSync(path.join(outDir, 'icon.ico'), makeIco(icoPng, 64));

console.log('Generated tray-idle.png, tray-recording.png, icon.ico in', outDir);
