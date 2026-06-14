const fs = require('fs');
const path = require('path');
const { app, clipboard } = require('electron');

const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'electron') return require.resolve('./electron-stub.js');
  return origResolve.call(this, request, parent, ...rest);
};

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
  const text = await whisper.transcribe(wav, { modelName: 'small', language: 'auto' });
  console.log('TRANSCRIPT:', JSON.stringify(text));
  console.log('(clipboard write happens in the live app via main.js)');
  process.exit(0);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
