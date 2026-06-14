const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'electron') return require.resolve('./electron-stub.js');
  return origResolve.call(this, request, parent, ...rest);
};

const fs = require('fs');
const path = require('path');
const { encodeWav, floatTo16BitPCM, trimSilence } = require('../src/audio');
const whisper = require('../src/whisper');

(async () => {
  const sr = 16000;
  const samples = Math.floor(sr * 1.0);
  const float = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    float[i] = Math.sin(2 * Math.PI * 880 * (i / sr)) * 0.2;
  }
  const wav = encodeWav(floatTo16BitPCM(float), sr, 1);
  console.log('--- warm call 1 (BLAS build) ---');
  const t0 = Date.now();
  const r0 = await whisper.transcribeAuto(wav, { modelName: 'small', language: 'auto' });
  console.log('warm 1:', Date.now() - t0, 'ms, text:', JSON.stringify(r0));
  console.log('--- warm call 2 ---');
  const t1 = Date.now();
  const r1 = await whisper.transcribeAuto(wav, { modelName: 'small', language: 'auto' });
  console.log('warm 2:', Date.now() - t1, 'ms, text:', JSON.stringify(r1));
  console.log('--- warm call 3 ---');
  const t2 = Date.now();
  const r2 = await whisper.transcribeAuto(wav, { modelName: 'small', language: 'auto' });
  console.log('warm 3:', Date.now() - t2, 'ms, text:', JSON.stringify(r2));
  whisper.stopServer();
  process.exit(0);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
