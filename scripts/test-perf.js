const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'electron') return require.resolve('./electron-stub.js');
  return origResolve.call(this, request, parent, ...rest);
};

const fs = require('fs');
const path = require('path');
const { encodeWav, floatTo16BitPCM } = require('../src/audio');
const whisper = require('../src/whisper');

(async () => {
  const sr = 16000;
  const samples = Math.floor(sr * 1.0);
  const float = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    float[i] = Math.sin(2 * Math.PI * 880 * (i / sr)) * 0.2;
  }
  const wav = encodeWav(floatTo16BitPCM(float), sr, 1);

  console.log('autoTuneThreads:', whisper.autoTuneThreads());
  console.log('--- cold call (server must start + load model) ---');
  const t0 = Date.now();
  const cold = await whisper.transcribeAuto(wav, { modelName: 'small', language: 'auto' });
  console.log('cold:', Date.now() - t0, 'ms, text:', JSON.stringify(cold));

  console.log('--- warm call 1 ---');
  const t1 = Date.now();
  const warm1 = await whisper.transcribeAuto(wav, { modelName: 'small', language: 'auto' });
  console.log('warm1:', Date.now() - t1, 'ms, text:', JSON.stringify(warm1));

  console.log('--- warm call 2 ---');
  const t2 = Date.now();
  const warm2 = await whisper.transcribeAuto(wav, { modelName: 'small', language: 'auto' });
  console.log('warm2:', Date.now() - t2, 'ms, text:', JSON.stringify(warm2));

  console.log('--- warm call 3 ---');
  const t3 = Date.now();
  const warm3 = await whisper.transcribeAuto(wav, { modelName: 'small', language: 'auto' });
  console.log('warm3:', Date.now() - t3, 'ms, text:', JSON.stringify(warm3));

  whisper.stopServer();
  process.exit(0);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
