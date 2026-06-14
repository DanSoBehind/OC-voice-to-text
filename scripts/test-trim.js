const { floatTo16BitPCM, trimSilence, encodeWav } = require('../src/audio');
const fs = require('fs');
const path = require('path');

const sr = 16000;
function sine(durationSec, freq, amp) {
  const n = Math.floor(sr * durationSec);
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = Math.sin(2 * Math.PI * freq * (i / sr)) * amp;
  return f;
}
function silence(durationSec) {
  return new Float32Array(Math.floor(sr * durationSec));
}
function concat(...arrs) {
  let len = 0;
  for (const a of arrs) len += a.length;
  const out = new Float32Array(len);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

const tests = [
  { name: '1s silence + 2s tone + 1s silence', pcm: floatTo16BitPCM(concat(silence(1), sine(2, 440, 0.5), silence(1))) },
  { name: 'all silence', pcm: floatTo16BitPCM(silence(2)) },
  { name: 'all tone (no trim needed)', pcm: floatTo16BitPCM(sine(2, 440, 0.5)) },
  { name: 'short tone (below min duration)', pcm: floatTo16BitPCM(concat(silence(0.2), sine(0.2, 440, 0.5), silence(0.2))) },
];

for (const t of tests) {
  const origSamples = t.pcm.length / 2;
  const trimmed = trimSilence(t.pcm, sr);
  const trimSamples = trimmed.length / 2;
  const ratio = (trimSamples / origSamples * 100).toFixed(1);
  console.log(`${t.name}: ${origSamples} -> ${trimSamples} samples (${ratio}%)`);
}
