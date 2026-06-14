// Simulate the capture.html logic in plain Node by mocking the browser globals.
// This lets us verify the start/stop/start sequence works correctly.

const { EventEmitter } = require('events');

class MockMediaStreamTrack {
  constructor() { this.readyState = 'live'; this.kind = 'audio'; }
  stop() { this.readyState = 'ended'; }
  applyConstraints() { return Promise.resolve(); }
}

let streamIdCounter = 0;
class MockMediaStream {
  constructor() {
    this.id = ++streamIdCounter;
    this.active = true;
    this._tracks = [new MockMediaStreamTrack(), new MockMediaStreamTrack()];
  }
  getTracks() { return this._tracks; }
  getAudioTracks() { return this._tracks; }
}

class MockAudioBuffer {
  constructor(channels, length, sampleRate) {
    this._channels = [];
    for (let i = 0; i < channels; i++) {
      this._channels.push(new Float32Array(length));
    }
    this.sampleRate = sampleRate;
    this.length = length;
  }
  getChannelData(c) { return this._channels[c]; }
}

class MockAudioNode {
  constructor(ctx) {
    this.context = ctx;
    this._ctx = ctx;
  }
  connect(dest) { this._ctx._addConnection(this, dest); return dest; }
  disconnect() { this._ctx._removeConnections(this); }
}

class MockScriptProcessor extends MockAudioNode {
  constructor(ctx, bufferSize, inputCount, outputCount) {
    super(ctx);
    this.bufferSize = bufferSize;
    this.onaudioprocess = null;
  }
  fireProcess(samples) {
    if (this.onaudioprocess) {
      const inputBuffer = new MockAudioBuffer(1, samples.length, this._ctx.sampleRate);
      inputBuffer.getChannelData(0).set(samples);
      const outputBuffer = new MockAudioBuffer(1, samples.length, this._ctx.sampleRate);
      this.onaudioprocess({ inputBuffer, outputBuffer });
    }
  }
}

class MockMediaStreamSource extends MockAudioNode {}

let audioContextIdCounter = 0;
class MockAudioContext {
  constructor(opts) {
    this.id = ++audioContextIdCounter;
    this.sampleRate = opts.sampleRate || 16000;
    this.state = 'running';
    this._connections = [];
  }
  createMediaStreamSource(stream) {
    const s = new MockMediaStreamSource(this);
    s._stream = stream;
    return s;
  }
  createScriptProcessor(bs, in_, out_) {
    return new MockScriptProcessor(this, bs, in_, out_);
  }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.state = 'closed'; }
  _addConnection(from, to) { this._connections.push({ from, to }); }
  _removeConnections(from) { this._connections = this._connections.filter(c => c.from !== from); }
}

const mockGlobal = {
  AudioContext: MockAudioContext,
  navigator: {
    mediaDevices: {
      getUserMedia: async () => new MockMediaStream(),
    },
  },
};

const sentData = [];
const sentStates = [];
const mockIpc = {
  send: (channel, data) => {
    if (channel === 'capture:data') sentData.push(data);
    else if (channel === 'capture:state') sentStates.push(data);
  },
};

const electron = { ipcRenderer: mockIpc };
const { ipcRenderer } = electron;

const TARGET_SR = 16000;
const BUFFER_SIZE = 4096;

let ctx = null;
let processor = null;
let source = null;
let stream = null;
let capturing = false;

function postState(state, extra) {
  ipcRenderer.send('capture:state', { state, ...(extra || {}) });
}

function releaseStream() {
  if (stream) {
    try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    stream = null;
  }
  if (source) {
    try { source.disconnect(); } catch (_) {}
    source = null;
  }
}

async function ensureContext() {
  if (ctx) {
    if (ctx.state === 'suspended') await ctx.resume();
    return;
  }
  const AC = mockGlobal.AudioContext;
  ctx = new AC({ sampleRate: TARGET_SR });
  processor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);
  processor.connect(ctx.destination);
  processor.onaudioprocess = (e) => {
    if (!capturing) return;
    const input = e.inputBuffer.getChannelData(0);
    ipcRenderer.send('capture:data', input.slice());
  };
}

async function acquireStream() {
  if (stream && stream.active) return;
  if (stream) releaseStream();
  stream = await mockGlobal.navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}

async function rebindSource() {
  if (source) {
    try { source.disconnect(); } catch (_) {}
    source = null;
  }
  source = ctx.createMediaStreamSource(stream);
  source.connect(processor);
}

async function prewarm() {
  try {
    await ensureContext();
    await acquireStream();
    await rebindSource();
    postState('prewarmed', { sampleRate: ctx.sampleRate });
  } catch (err) {
    postState('error', { message: err.message });
  }
}

async function start() {
  try {
    if (!ctx) await ensureContext();
    else if (ctx.state === 'suspended') await ctx.resume();
    await acquireStream();
    await rebindSource();
    capturing = true;
    postState('started', { sampleRate: ctx.sampleRate });
  } catch (err) {
    postState('error', { message: err.message });
  }
}

function stop() {
  capturing = false;
  if (ctx) {
    try { ctx.suspend(); } catch (_) {}
  }
  releaseStream();
  postState('stopped');
}

(async () => {
  console.log('=== Scenario 1: prewarm + start + stop + start + stop + start + stop ===');
  console.log('--- prewarm ---');
  await prewarm();
  console.log('state after prewarm:', sentStates.map(s => s.state).join(','));
  console.log('stream active:', stream.active, 'source bound:', !!source);

  console.log('--- start #1 ---');
  await start();
  processor.fireProcess(new Float32Array([0.1, 0.2, 0.3]));
  console.log('capturing:', capturing, 'data chunks:', sentData.length);
  console.log('stream active:', stream.active, 'source bound:', !!source);

  console.log('--- stop #1 ---');
  stop();
  console.log('capturing:', capturing, 'stream active:', stream ? stream.active : 'null', 'source bound:', !!source);

  console.log('--- start #2 ---');
  await start();
  processor.fireProcess(new Float32Array([0.4, 0.5, 0.6]));
  console.log('capturing:', capturing, 'data chunks:', sentData.length);
  console.log('stream active:', stream.active, 'source bound:', !!source);

  console.log('--- stop #2 ---');
  stop();

  console.log('--- start #3 ---');
  await start();
  processor.fireProcess(new Float32Array([0.7, 0.8, 0.9]));
  console.log('capturing:', capturing, 'data chunks:', sentData.length);
  console.log('stream active:', stream.active, 'source bound:', !!source);

  console.log('--- stop #3 ---');
  stop();

  console.log('\n=== summary ===');
  console.log('total data chunks captured:', sentData.length, '(expected: 3)');
  console.log('states:', sentStates.map(s => s.state).join(' -> '));
})().catch(err => { console.error('FAIL:', err); process.exit(1); });
