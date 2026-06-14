const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut, dialog, Notification, clipboard, screen } = require('electron');
const path = require('path');
const settings = require('./src/settings');
const { encodeWav, floatTo16BitPCM, resampleTo16k, trimSilence } = require('./src/audio');
const whisper = require('./src/whisper');
const { sendCtrlV } = require('./src/paste');

let tray = null;
let mainWindow = null;
let settingsWindow = null;
let captureWindow = null;
let indicatorWindow = null;
let captureStream = null;
let isRecording = false;
let micPrewarmed = false;

const isDev = !app.isPackaged;
const APP_ICON = path.join(__dirname, 'assets', 'icon.ico');

if (process.platform === 'win32') {
  app.setAppUserModelId('com.oc.voicetotext');
}

function getAssetPath(name) {
  return path.join(__dirname, 'assets', name);
}

function createTrayIcon(state) {
  const iconName = state === 'recording' ? 'tray-recording.png' : 'tray-idle.png';
  const image = nativeImage.createFromPath(getAssetPath(iconName));
  if (image.isEmpty()) return nativeImage.createEmpty();
  return image;
}

function setTrayState(state) {
  if (!tray) return;
  tray.setImage(createTrayIcon(state));
  if (state === 'recording') tray.setToolTip('OC Voice to Text — Recording…');
  else if (state === 'transcribing') tray.setToolTip('OC Voice to Text — Transcribing…');
  else tray.setToolTip('OC Voice to Text — Idle');
  if (state !== 'recording') {
    hideIndicator();
  }
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = new BrowserWindow({
    width: 260,
    height: 90,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    icon: APP_ICON,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('close', (e) => { e.preventDefault(); mainWindow.hide(); });
  return mainWindow;
}

function showMainWindow() {
  const win = createMainWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 520,
    height: 560,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'OC Voice to Text — Settings',
    icon: APP_ICON,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWindow.on('close', (e) => {
    e.preventDefault();
    settingsWindow.hide();
  });
}

function createCaptureWindow() {
  if (captureWindow && !captureWindow.isDestroyed()) return captureWindow;
  captureWindow = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    skipTaskbar: true,
    icon: APP_ICON,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
    },
  });
  captureWindow.loadFile(path.join(__dirname, 'src', 'capture.html'));
  return captureWindow;
}

const INDICATOR_WIDTH = 80;
const INDICATOR_HEIGHT = 48;

function createIndicatorWindow() {
  if (indicatorWindow && !indicatorWindow.isDestroyed()) return indicatorWindow;
  indicatorWindow = new BrowserWindow({
    width: INDICATOR_WIDTH,
    height: INDICATOR_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    icon: APP_ICON,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  indicatorWindow.setMenuBarVisibility(false);
  indicatorWindow.setAlwaysOnTop(true, 'screen-saver');
  indicatorWindow.loadFile(path.join(__dirname, 'renderer', 'indicator.html'));
  positionIndicatorWindow();
  screen.on('display-metrics-changed', positionIndicatorWindow);
  screen.on('display-added', positionIndicatorWindow);
  screen.on('display-removed', positionIndicatorWindow);
  return indicatorWindow;
}

function positionIndicatorWindow() {
  if (!indicatorWindow || indicatorWindow.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const { workArea, bounds } = display;
  const x = Math.round(workArea.x + (workArea.width - INDICATOR_WIDTH) / 2);
  const taskbarHeight = bounds.height - workArea.height;
  const y = Math.round(bounds.height - taskbarHeight - INDICATOR_HEIGHT - 8);
  indicatorWindow.setBounds({ x, y, width: INDICATOR_WIDTH, height: INDICATOR_HEIGHT });
}

function showIndicator() {
  if (!indicatorWindow || indicatorWindow.isDestroyed()) return;
  positionIndicatorWindow();
  indicatorWindow.showInactive();
}

function hideIndicator() {
  if (indicatorWindow && !indicatorWindow.isDestroyed() && indicatorWindow.isVisible()) {
    indicatorWindow.hide();
  }
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: 'Show window', click: () => showMainWindow() },
    { label: 'Settings…', click: () => openSettingsWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } },
  ]);
}

function createTray() {
  tray = new Tray(createTrayIcon('idle'));
  tray.setToolTip('OC Voice to Text — Idle');
  tray.setContextMenu(buildMenu());
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
}

function registerHotkey() {
  globalShortcut.unregisterAll();
  const start = settings.get('startHotkey');
  const stop = settings.get('stopHotkey');
  const same = !!start && start === stop;
  const okS = globalShortcut.register(start, same ? () => toggleRecording() : () => startRecording());
  if (!okS) {
    console.error('Failed to register start hotkey:', start);
    dialog.showErrorBox('Hotkey failed', `Could not register ${start}. Open Settings to pick another.`);
    return false;
  }
  if (!same) {
    const okT = globalShortcut.register(stop, () => stopRecording());
    if (!okT) {
      console.error('Failed to register stop hotkey:', stop);
      dialog.showErrorBox('Hotkey failed', `Could not register ${stop}. Open Settings to pick another.`);
    }
  }
  return true;
}

function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

function startRecording() {
  if (isRecording) return;
  isRecording = true;
  captureStream = { chunks: [], inputSampleRate: 16000 };

  setTrayState('recording');
  broadcast('recording:starting');

  const win = createCaptureWindow();
  if (win.isDestroyed()) {
    isRecording = false;
    broadcast('error', 'Capture window failed');
    return;
  }

  const doStart = () => {
    if (!isRecording) return;
    broadcast('recording:start');
    win.webContents.send('capture:cmd', 'start');
  };

  if (micPrewarmed) {
    doStart();
  } else {
    micPrewarmed = true;
    const onState = (event, msg) => {
      if (!msg) return;
      if (msg.state === 'prewarmed') {
        ipcMain.removeListener('capture:state', onState);
        doStart();
      } else if (msg.state === 'error') {
        ipcMain.removeListener('capture:state', onState);
        isRecording = false;
        broadcast('error', msg.message || 'Microphone error');
        setTrayState('idle');
      }
    };
    ipcMain.on('capture:state', onState);
    win.webContents.send('capture:cmd', 'prewarm');
  }
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  setTrayState('transcribing');
  broadcast('recording:stop');

  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.webContents.send('capture:cmd', 'stop');
  }
}

ipcMain.on('capture:data', (event, float32Array) => {
  if (!isRecording || !captureStream) return;
  const buf = Buffer.from(float32Array.buffer, float32Array.byteOffset, float32Array.byteLength);
  captureStream.chunks.push(buf);
});

ipcMain.on('capture:state', (event, msg) => {
  if (!msg) return;
  if (msg.state === 'started') {
    if (captureStream) captureStream.inputSampleRate = msg.sampleRate || 16000;
    showIndicator();
  } else if (msg.state === 'stopped') {
    hideIndicator();
    finalizeRecording();
  } else if (msg.state === 'prewarmed') {
    if (captureStream) captureStream.inputSampleRate = msg.sampleRate || 16000;
  } else if (msg.state === 'error') {
    isRecording = false;
    captureStream = null;
    setTrayState('idle');
    hideIndicator();
    broadcast('error', msg.message || 'Microphone error');
  }
});

ipcMain.on('capture:error', (event, message) => {
  isRecording = false;
  captureStream = null;
  setTrayState('idle');
  hideIndicator();
  broadcast('error', message || 'Microphone error');
});

ipcMain.on('indicator:click', () => {
  if (isRecording) {
    stopRecording();
  }
});

function finalizeRecording() {
  const stream = captureStream;
  captureStream = null;
  if (!stream || stream.chunks.length === 0) {
    setTrayState('idle');
    broadcast('error', 'No audio captured');
    return;
  }
  const merged = Buffer.concat(stream.chunks);
  const inputAsFloat = new Float32Array(merged.buffer, merged.byteOffset, merged.byteLength / 4);
  const resampled = resampleTo16k(inputAsFloat, stream.inputSampleRate || 16000);
  const pcm16 = floatTo16BitPCM(resampled);
  const trimmed = trimSilence(pcm16, 16000);
  const wav = encodeWav(trimmed, 16000, 1);

  transcribeWav(wav).catch((err) => {
    console.error('Transcription failed:', err);
    setTrayState('idle');
    broadcast('error', err && err.message ? err.message : 'Transcription failed');
  });
}

function transcribeWav(wav) {
  const modelName = settings.get('model') || 'small';
  const language = settings.get('language') || 'auto';

  if (!whisper.getBinPath() || !require('fs').existsSync(whisper.getBinPath())) {
    setTrayState('idle');
    broadcast('error', 'Whisper binary missing — opening settings');
    showMainWindow();
    return;
  }
  if (!whisper.getModelPath(modelName) || !require('fs').existsSync(whisper.getModelPath(modelName))) {
    setTrayState('idle');
    broadcast('error', `Model "${modelName}" missing — downloading…`);
    showMainWindow();
    downloadWhisperAssets(modelName);
    return;
  }

  setTrayState('transcribing');
  broadcast('transcribing');

  return whisper.transcribeAuto(wav, { modelName, language }).then((text) => {
    setTrayState('idle');
    if (text && text.trim().length > 0) {
      deliverResult(text);
    } else {
      broadcast('error', 'No speech detected');
    }
  });
}

function deliverResult(text) {
  clipboard.writeText(text);

  const autoPaste = settings.get('autoPaste') !== false;
  const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text;

  if (!autoPaste) {
    broadcast('done', `[Copied] ${preview}`);
    return;
  }

  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.hide();
  }

  setTimeout(() => {
    sendCtrlV().then((res) => {
      if (res.code !== 0 && res.stderr) {
        console.error('Paste failed:', res.stderr);
        broadcast('error', 'Paste failed — text is on clipboard');
        return;
      }
      broadcast('done', `[Pasted] ${preview}`);
    });
  }, 80);
}

function downloadWhisperAssets(modelName) {
  setTrayState('transcribing');
  broadcast('transcribing', 'Downloading speech model…');
  whisper.downloadAll(modelName, (frac, _total, stage) => {
    const pct = Math.round(frac * 100);
    if (stage === 'binary') {
      broadcast('transcribing', `Downloading engine (${pct}%)`);
    } else if (stage === 'model') {
      broadcast('transcribing', `Downloading model (${pct}%)`);
    } else if (stage === 'done') {
      broadcast('transcribing', 'Ready');
      if (Notification.isSupported()) {
        new Notification({ title: 'OC Voice to Text', body: 'Model downloaded — ready to transcribe.' }).show();
      }
      setTrayState('idle');
    }
  }).catch((err) => {
    console.error('Whisper download failed:', err);
    setTrayState('idle');
    broadcast('error', 'Model download failed: ' + (err.message || err));
  });
}

ipcMain.handle('settings:get', (_e, key) => {
  if (key === 'autostart') {
    if (process.platform === 'win32') {
      return app.getLoginItemSettings().openAtLogin;
    }
    return false;
  }
  return settings.get(key);
});

ipcMain.handle('settings:set', (_e, key, value) => {
  if (key === 'autostart') {
    if (process.platform === 'win32') {
      app.setLoginItemSettings({
        openAtLogin: !!value,
        openAsHidden: true,
        args: ['--hidden'],
      });
    }
    return !!value;
  }
  const result = settings.set(key, value);
  if (key === 'hotkey' || key === 'startHotkey' || key === 'stopHotkey') registerHotkey();
  if (key === 'model') {
    whisper.stopServer();
    prewarmWhisperServer();
  }
  return result;
});

ipcMain.handle('settings:hide', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.hide();
  return true;
});

ipcMain.handle('settings:open', () => {
  openSettingsWindow();
  return true;
});

ipcMain.handle('whisper:download', (_e, modelName) => {
  downloadWhisperAssets(modelName || settings.get('model') || 'small');
  return true;
});

ipcMain.handle('whisper:status', () => {
  const modelName = settings.get('model') || 'small';
  return {
    binReady: require('fs').existsSync(whisper.getBinPath()),
    modelReady: require('fs').existsSync(whisper.getModelPath(modelName)),
    model: modelName,
  };
});

ipcMain.handle('tray:set-state', (_e, state) => { setTrayState(state); return true; });
ipcMain.handle('window:hide', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); return true; });

app.whenReady().then(() => {
  createTray();
  if (process.argv.includes('--hidden')) {
    createMainWindow();
  } else {
    showMainWindow();
  }
  registerHotkey();
  if (isDev) console.log('Running in dev mode — start hotkey:', settings.get('startHotkey'), 'stop hotkey:', settings.get('stopHotkey'));

  createCaptureWindow();
  createIndicatorWindow();
  prewarmWhisperServer();
});

function prewarmWhisperServer() {
  const modelName = settings.get('model') || 'small';
  const bin = whisper.getServerBinPath();
  const model = whisper.getModelPath(modelName);
  if (!require('fs').existsSync(bin) || !require('fs').existsSync(model)) {
    return;
  }
  whisper.ensureServer(modelName).then(() => {
    if (isDev) console.log(`Whisper server pre-warmed (${whisper.autoTuneThreads()} threads)`);
  }).catch((err) => {
    console.warn('Whisper server pre-warm failed (will fall back per-call):', err.message);
  });
}

app.on('window-all-closed', (e) => { e.preventDefault(); });

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  whisper.stopServer();
  hideIndicator();
});

app.on('before-quit', () => { app.isQuiting = true; });
