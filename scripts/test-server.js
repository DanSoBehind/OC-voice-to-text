const fs = require('fs');
const path = require('path');
const http = require('http');
const { encodeWav, floatTo16BitPCM } = require('../src/audio');

const sr = 16000;
const samples = Math.floor(sr * 1.0);
const float = new Float32Array(samples);
for (let i = 0; i < samples; i++) {
  float[i] = Math.sin(2 * Math.PI * 880 * (i / sr)) * 0.2;
}
const wav = encodeWav(floatTo16BitPCM(float), sr, 1);
const tmpWav = path.join(require('os').tmpdir(), 'server-test.wav');
fs.writeFileSync(tmpWav, wav);
console.log('wrote', tmpWav, wav.length, 'bytes');

const t0 = Date.now();
const boundary = '----OC' + Date.now();
const fileBuf = fs.readFileSync(tmpWav);
const head = Buffer.from(
  `--${boundary}\r\n` +
  `Content-Disposition: form-data; name="file"; filename="test.wav"\r\n` +
  `Content-Type: audio/wav\r\n\r\n`
);
const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
const body = Buffer.concat([head, fileBuf, tail]);

const req = http.request({
  hostname: '127.0.0.1',
  port: 39871,
  path: '/inference',
  method: 'POST',
  headers: {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length,
  },
}, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const dt = Date.now() - t0;
    console.log('HTTP', res.statusCode, 'in', dt, 'ms');
    console.log('---response (first 800 chars)---');
    console.log(data.slice(0, 800));
    console.log('---end---');
    try {
      const json = JSON.parse(data);
      console.log('text:', JSON.stringify(json.text || ''));
    } catch (e) {
      console.log('not JSON');
    }
    process.exit(0);
  });
});
req.on('error', (e) => { console.error('ERR', e.message); process.exit(1); });
req.write(body);
req.end();
