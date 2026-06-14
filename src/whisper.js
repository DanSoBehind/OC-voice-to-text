const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { app } = require('electron');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');

const WHISPER_VERSION = 'v1.8.6';
const WHISPER_BIN_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-blas-bin-x64.zip`;
const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
const BINARY_BUILD = 'blas-x64-1.8.6';

const MODELS = {
  tiny: { file: 'ggml-tiny.bin', size: 75 * 1024 * 1024 },
  base: { file: 'ggml-base.bin', size: 142 * 1024 * 1024 },
  small: { file: 'ggml-small.bin', size: 466 * 1024 * 1024 },
  medium: { file: 'ggml-medium.bin', size: 1500 * 1024 * 1024 },
  'large-v3': { file: 'ggml-large-v3.bin', size: 3094 * 1024 * 1024 },
};

function getBaseDir() {
  return path.join(app.getPath('userData'), 'whisper');
}

function getBinPath() {
  return path.join(getBaseDir(), 'bin', 'Release', 'whisper-cli.exe');
}

function getModelPath(name) {
  const m = MODELS[name] || MODELS.small;
  return path.join(getBaseDir(), 'models', m.file);
}

function fileExists(p) {
  try { return fs.existsSync(p); } catch (_) { return false; }
}

function followRedirects(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
        res.resume();
        return resolve(followRedirects(res.headers.location, maxRedirects - 1));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      resolve(res);
    });
    req.on('error', reject);
  });
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    followRedirects(url).then((res) => {
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (onProgress && total) onProgress(downloaded, total);
      });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(dest)));
      out.on('error', reject);
      res.on('error', reject);
    }).catch(reject);
  });
}

async function ensureBinary(onProgress) {
  const binPath = getBinPath();
  const settings = require('./settings');
  const installedBuild = settings.get('binaryBuild');
  if (fileExists(binPath) && installedBuild === BINARY_BUILD) {
    return binPath;
  }

  const tmpZip = path.join(getBaseDir(), 'whisper-bin.zip');
  const target = path.join(getBaseDir(), 'bin');
  if (fileExists(target)) {
    try { fs.rmSync(target, { recursive: true, force: true }); } catch (_) {}
  }
  fs.mkdirSync(target, { recursive: true });

  await downloadFile(WHISPER_BIN_URL, tmpZip, onProgress);

  const { execFile } = require('child_process');
  await new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile', '-Command',
      `Expand-Archive -LiteralPath "${tmpZip}" -DestinationPath "${target}" -Force`,
    ], (err) => err ? reject(err) : resolve());
  });

  fs.unlinkSync(tmpZip);
  settings.set('binaryBuild', BINARY_BUILD);
  return binPath;
}

async function ensureModel(modelName, onProgress) {
  const info = MODELS[modelName] || MODELS.small;
  const dest = getModelPath(modelName);
  if (fileExists(dest)) return dest;

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const url = `${HF_BASE}/${info.file}`;
  await downloadFile(url, dest, onProgress);
  return dest;
}

function transcribe(wavBuffer, { modelName = 'small', language = 'auto' } = {}) {
  return new Promise((resolve, reject) => {
    const bin = getBinPath();
    const modelPath = getModelPath(modelName);
    if (!fileExists(bin)) return reject(new Error('Whisper binary missing. Run download.'));
    if (!fileExists(modelPath)) return reject(new Error('Whisper model missing. Run download.'));

    const tmpDir = path.join(app.getPath('userData'), 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const wavPath = path.join(tmpDir, `rec-${Date.now()}.wav`);
    fs.writeFileSync(wavPath, wavBuffer);

    const args = [
      '-m', modelPath,
      '-f', wavPath,
      '-np',
      '-nt',
    ];
    if (language && language !== 'auto') {
      args.push('-l', language);
    } else {
      args.push('-l', 'auto');
    }

    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      try { fs.unlinkSync(wavPath); } catch (_) {}
      if (code !== 0) {
        return reject(new Error(`Whisper exited ${code}: ${stderr.slice(-500)}`));
      }
      const text = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('whisper_') && !l.startsWith('system_'))
        .join(' ')
        .trim();
      resolve(text);
    });
  });
}

async function downloadAll(modelName, onProgress) {
  const stages = [
    { name: 'binary', weight: 0.05 },
    { name: 'model', weight: 0.95 },
  ];
  let totalDone = 0;
  const emit = (stage, downloaded, total) => {
    const stageWeight = stages.find((s) => s.name === stage).weight;
    const stageTotal = stage === 'binary' ? 5 * 1024 * 1024 : (MODELS[modelName] || MODELS.small).size;
    const frac = Math.min(1, downloaded / stageTotal);
    const overall = totalDone + frac * stageWeight;
    if (onProgress) onProgress(overall, 1, stage);
  };
  await ensureBinary((d, t) => emit('binary', d, t));
  totalDone += stages[0].weight;
  await ensureModel(modelName, (d, t) => emit('model', d, t));
  totalDone += stages[1].weight;
  stopServer();
  if (onProgress) onProgress(1, 1, 'done');
}

function getServerBinPath() {
  return path.join(getBaseDir(), 'bin', 'Release', 'whisper-server.exe');
}

function autoTuneThreads() {
  const logical = os.cpus() ? os.cpus().length : 4;
  const physicalGuess = Math.max(1, Math.floor(logical / 2));
  return Math.min(8, Math.max(2, physicalGuess));
}

function pickFreePort(start, tries = 20) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryPort = () => {
      if (attempt >= tries) return reject(new Error('No free port found'));
      attempt++;
      const port = start + attempt - 1;
      const srv = net.createServer();
      srv.once('error', () => tryPort());
      srv.once('listening', () => {
        srv.close(() => resolve(port));
      });
      srv.listen(port, '127.0.0.1');
    };
    tryPort();
  });
}

const serverState = {
  child: null,
  port: null,
  host: '127.0.0.1',
  modelName: null,
  starting: null,
  lastError: null,
};

function stopServer() {
  if (serverState.child && !serverState.child.killed) {
    try { serverState.child.kill(); } catch (_) {}
  }
  serverState.child = null;
  serverState.port = null;
  serverState.modelName = null;
  serverState.starting = null;
}

async function waitForServer(child, port, timeoutMs = 60000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request({
        hostname: '127.0.0.1', port, path: '/', method: 'GET', timeout: 1500,
      }, (res) => {
        res.resume();
        if (res.statusCode) return resolve();
        retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
      req.end();
    };
    const retry = () => {
      if (Date.now() - t0 > timeoutMs) {
        return reject(new Error('Server did not become ready in time'));
      }
      if (child.killed || child.exitCode != null) {
        return reject(new Error('Server process exited before ready'));
      }
      setTimeout(tryOnce, 250);
    };
    tryOnce();
  });
}

async function ensureServer(modelName) {
  if (serverState.child && !serverState.child.killed && serverState.modelName === modelName && serverState.port) {
    return { host: serverState.host, port: serverState.port };
  }
  if (serverState.child && !serverState.child.killed) {
    stopServer();
  }
  if (serverState.starting) return serverState.starting;

  const bin = getServerBinPath();
  const modelPath = getModelPath(modelName);
  if (!fileExists(bin)) throw new Error('whisper-server.exe not downloaded');
  if (!fileExists(modelPath)) throw new Error(`Model "${modelName}" not downloaded`);

  serverState.starting = (async () => {
    const port = await pickFreePort(39871);
    const threads = autoTuneThreads();
    const args = [
      '-m', modelPath,
      '-t', String(threads),
      '-l', 'auto',
      '-nt',
      '--host', '127.0.0.1',
      '--port', String(port),
    ];
    const child = spawn(bin, args, { windowsHide: true });
    serverState.child = child;
    serverState.port = port;
    serverState.host = '127.0.0.1';
    serverState.modelName = modelName;

    let stderrBuf = '';
    child.stderr.on('data', (d) => { stderrBuf += d.toString('utf8'); });
    child.on('exit', (code) => {
      if (serverState.child === child) {
        serverState.lastError = code != null ? `Server exited ${code}: ${stderrBuf.slice(-300)}` : null;
        serverState.child = null;
        serverState.port = null;
        serverState.modelName = null;
      }
    });
    child.on('error', (err) => {
      serverState.lastError = err.message;
    });

    try {
      await waitForServer(child, port);
    } catch (err) {
      stopServer();
      throw err;
    }
    return { host: serverState.host, port: serverState.port };
  })();

  try {
    return await serverState.starting;
  } finally {
    serverState.starting = null;
  }
}

function transcribeViaServer(wavBuffer, { modelName = 'small', language = 'auto' } = {}) {
  return new Promise((resolve, reject) => {
    ensureServer(modelName).then(({ host, port }) => {
      const boundary = `----OC${Date.now()}`;
      const head = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="rec.wav"\r\n` +
        `Content-Type: audio/wav\r\n\r\n`
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      const body = Buffer.concat([head, wavBuffer, tail]);

      const langParam = (language && language !== 'auto') ? `&language=${encodeURIComponent(language)}` : '';
      const req = http.request({
        hostname: host,
        port,
        path: `/inference?response_format=json${langParam}`,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
        timeout: 120000,
      }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`Server HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
          try {
            const json = JSON.parse(data);
            const text = (json.text || '').replace(/^\s+|\s+$/g, '');
            resolve(text);
          } catch (err) {
            reject(new Error('Invalid JSON from server: ' + data.slice(0, 200)));
          }
        });
      });
      req.on('timeout', () => { req.destroy(new Error('Server request timed out')); });
      req.on('error', (err) => reject(err));
      req.write(body);
      req.end();
    }).catch(reject);
  });
}

async function transcribeAuto(wavBuffer, opts) {
  try {
    return await transcribeViaServer(wavBuffer, opts);
  } catch (err) {
    console.warn('Server path failed, falling back to spawn-per-call:', err.message);
    return transcribe(wavBuffer, opts);
  }
}

module.exports = {
  MODELS,
  transcribe,
  transcribeViaServer,
  transcribeAuto,
  ensureBinary,
  ensureModel,
  ensureServer,
  stopServer,
  downloadAll,
  getBinPath,
  getModelPath,
  getServerBinPath,
  autoTuneThreads,
};
