function encodeWav(pcmBuffer, sampleRate, numChannels) {
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(buffer, headerSize);

  return buffer;
}

function floatTo16BitPCM(float32) {
  const length = float32.length;
  const out = Buffer.alloc(length * 2);
  for (let i = 0; i < length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    out.writeInt16LE(s | 0, i * 2);
  }
  return out;
}

function resampleTo16k(float32, inputSampleRate) {
  if (inputSampleRate === 16000) return float32;
  const ratio = 16000 / inputSampleRate;
  const outLength = Math.round(float32.length * ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const t = i / ratio;
    const i0 = Math.floor(t);
    const i1 = Math.min(float32.length - 1, i0 + 1);
    const frac = t - i0;
    out[i] = float32[i0] * (1 - frac) + float32[i1] * frac;
  }
  return out;
}

function trimSilence(pcm16, sampleRate, options = {}) {
  const {
    thresholdDb = -40,
    minSilenceMs = 300,
    safetyPadMs = 200,
    minDurationMs = 500,
  } = options;

  const totalSamples = pcm16.length / 2;
  if (totalSamples * 1000 / sampleRate < minDurationMs) return pcm16;

  const threshold = Math.pow(10, thresholdDb / 20) * 32767;
  const windowSamples = Math.max(64, Math.floor(sampleRate * 0.02));
  const minSilenceSamples = Math.floor((minSilenceMs / 1000) * sampleRate);
  const safetyPadSamples = Math.floor((safetyPadMs / 1000) * sampleRate);

  function isSilentWindow(startIdx) {
    const end = Math.min(startIdx + windowSamples, totalSamples);
    let sum = 0;
    for (let i = startIdx; i < end; i++) {
      const s = pcm16.readInt16LE(i * 2);
      sum += s * s;
    }
    const rms = Math.sqrt(sum / (end - startIdx));
    return rms < threshold;
  }

  let firstLoudStart = -1;
  let trailingSilenceRun = 0;
  for (let i = 0; i < totalSamples; i += windowSamples) {
    if (isSilentWindow(i)) {
      trailingSilenceRun += windowSamples;
    } else {
      trailingSilenceRun = 0;
      if (firstLoudStart === -1) firstLoudStart = i;
    }
  }
  if (firstLoudStart === -1) return pcm16;
  if (trailingSilenceRun < minSilenceSamples) return pcm16;

  let lastLoudEnd = -1;
  let leadingSilenceRun = 0;
  for (let i = totalSamples - windowSamples; i >= 0; i -= windowSamples) {
    if (isSilentWindow(i)) {
      leadingSilenceRun += windowSamples;
    } else {
      leadingSilenceRun = 0;
      if (lastLoudEnd === -1) lastLoudEnd = Math.min(totalSamples, i + windowSamples);
    }
  }
  if (lastLoudEnd === -1) return pcm16;
  if (leadingSilenceRun < minSilenceSamples) return pcm16;

  const start = Math.max(0, firstLoudStart - safetyPadSamples);
  const end = Math.min(totalSamples, lastLoudEnd + safetyPadSamples);
  if (end - start >= totalSamples - 2 * safetyPadSamples) return pcm16;

  return pcm16.subarray(start * 2, end * 2);
}

module.exports = { encodeWav, floatTo16BitPCM, resampleTo16k, trimSilence };
