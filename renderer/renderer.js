const dot = document.getElementById('dot');
const label = document.getElementById('label');
const detail = document.getElementById('detail');
const closeBtn = document.getElementById('close');
const settingsBtn = document.getElementById('settings');

const STATES = {
  idle: { label: 'Idle' },
  starting: { label: 'Starting…' },
  recording: { label: 'Recording…' },
  transcribing: { label: 'Transcribing…' },
  done: { label: 'Done' },
  error: { label: 'Error' },
};

function setState(state, detailText) {
  const cfg = STATES[state] || STATES.idle;
  dot.className = `dot ${state}`;
  label.textContent = cfg.label;
  detail.textContent = detailText != null ? detailText : '';
}

async function refreshHotkeyHint() {
  try {
    const [start, stop] = await Promise.all([
      window.ocApi.getSetting('startHotkey'),
      window.ocApi.getSetting('stopHotkey'),
    ]);
    if (start && stop && start === stop) {
      detail.textContent = `${start} to start/stop`;
    } else if (start && stop) {
      detail.textContent = `${start} to start · ${stop} to stop`;
    } else if (start) {
      detail.textContent = `${start} to start`;
    }
  } catch (_) {}
}

window.ocApi.on('recording:starting', () => setState('starting', 'Opening microphone…'));
window.ocApi.on('recording:start', () => setState('recording', 'Press stop shortcut to finish'));
window.ocApi.on('recording:stop', () => setState('transcribing', 'Whisper is working'));
window.ocApi.on('transcribing', (_e, msg) => {
  const text = (typeof msg === 'string' && msg.length) ? msg : 'Whisper is working';
  setState('transcribing', text);
});
window.ocApi.on('done', (_event, text) => {
  const preview = typeof text === 'string'
    ? (text.length > 60 ? `${text.slice(0, 60)}…` : text)
    : 'Copied to clipboard';
  setState('done', preview);
  setTimeout(() => { setState('idle'); refreshHotkeyHint(); }, 4000);
});
window.ocApi.on('error', (_event, message) => {
  setState('error', message || 'Something went wrong');
  setTimeout(() => { setState('idle'); refreshHotkeyHint(); }, 5000);
});

closeBtn.addEventListener('click', () => window.ocApi.hideWindow());
settingsBtn.addEventListener('click', () => window.ocApi.openSettings());

(async function bootstrap() {
  setState('idle');
  await refreshHotkeyHint();
  try {
    const status = await window.ocApi.whisperStatus();
    if (!status.binReady || !status.modelReady) {
      detail.textContent = `Model "${status.model}" not downloaded — click tray → Settings to fetch`;
    }
  } catch (_) {}
})();
