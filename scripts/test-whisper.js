const fs = require('fs');
const path = require('path');

const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'electron') return require.resolve('./electron-stub.js');
  return origResolve.call(this, request, parent, ...rest);
};

const { encodeWav, floatTo16BitPCM } = require('../src/audio');
const whisper = require('../src/whisper');

const sr = 16000;
const duration = 1.0;
const samples = Math.floor(sr * duration);
const float = new Float32Array(samples);
for (let i = 0; i < samples; i++) {
  float[i] = Math.sin(2 * Math.PI * 440 * (i / sr)) * 0.2;
}
const pcm = floatTo16BitPCM(float);
const wav = encodeWav(pcm, sr, 1);

const out = path.join(require('os').tmpdir(), 'phase3-test.wav');
fs.writeFileSync(out, wav);
console.log('wrote', out, fs.statSync(out).size, 'bytes');

const modelName = 'small';
const bin = whisper.getBinPath();
const model = whisper.getModelPath(modelName);
console.log('bin:', bin, 'exists:', fs.existsSync(bin));
console.log('model:', model, 'exists:', fs.existsSync(model));

whisper.transcribe(wav, { modelName, language: 'auto' }).then((text) => {
  console.log('TRANSCRIPT:', JSON.stringify(text));
  process.exit(0);
}).catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
