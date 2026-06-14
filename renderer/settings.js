const $ = (id) => document.getElementById(id);

const startHotkeyInput = $('startHotkey');
const stopHotkeyInput = $('stopHotkey');
const startRecordBtn = $('startRecordBtn');
const stopRecordBtn = $('stopRecordBtn');
const sameAsStartBox = $('sameAsStart');
const hotkeyHint = $('hotkeyHint');
const hotkeyErr = $('hotkeyErr');
const languageSel = $('language');
const modelSel = $('model');
const modelHint = $('modelHint');
const autoPasteBox = $('autoPaste');
const autostartBox = $('autostart');
const saveBtn = $('saveBtn');
const cancelBtn = $('cancelBtn');
const statusBox = $('status');

const DEFAULTS = {
  startHotkey: 'CommandOrControl+Shift+Space',
  stopHotkey: 'CommandOrControl+Shift+Space',
  language: 'auto',
  model: 'small',
  autoPaste: true,
  autostart: false,
};

let pending = { ...DEFAULTS };
let activeCapture = null;

function setStatus(msg, kind) {
  statusBox.textContent = msg || '';
  statusBox.className = `status ${kind || ''}`;
  statusBox.style.display = msg ? 'block' : 'none';
}

function setHotkeyErr(msg) {
  hotkeyErr.textContent = msg || '';
  hotkeyErr.style.display = msg ? 'block' : 'none';
}

function keyName(code) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Space') return 'Space';
  if (code === 'Escape') return 'Esc';
  if (code === 'Tab') return 'Tab';
  if (code === 'Enter') return 'Return';
  if (code === 'ArrowUp') return 'Up';
  if (code === 'ArrowDown') return 'Down';
  if (code === 'ArrowLeft') return 'Left';
  if (code === 'ArrowRight') return 'Right';
  if (code === 'Backspace') return 'Backspace';
  if (code === 'Delete') return 'Delete';
  if (code === 'Home') return 'Home';
  if (code === 'End') return 'End';
  if (code === 'PageUp') return 'PageUp';
  if (code === 'PageDown') return 'PageDown';
  if (code === 'Minus') return '-';
  if (code === 'Equal') return '=';
  if (code === 'BracketLeft') return '[';
  if (code === 'BracketRight') return ']';
  if (code === 'Backslash') return '\\';
  if (code === 'Semicolon') return ';';
  if (code === 'Quote') return "'";
  if (code === 'Comma') return ',';
  if (code === 'Period') return '.';
  if (code === 'Slash') return '/';
  if (code === 'Backquote') return '`';
  if (/^F\d{1,2}$/.test(code)) return code;
  return code;
}

function buildAccelerator(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');
  const key = keyName(e.code);
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  if (!key) return null;
  parts.push(key);
  return parts.join('+');
}

function previousValueFor(inputEl) {
  if (inputEl === startHotkeyInput) return pending.startHotkey;
  if (inputEl === stopHotkeyInput) return pending.stopHotkey;
  return '';
}

function startCapture(inputEl, btnEl) {
  if (activeCapture) stopCapture(false);
  activeCapture = { inputEl, btnEl };
  inputEl.value = '';
  inputEl.placeholder = 'Press a key combination…';
  hotkeyHint.innerHTML = '<span class="recording">● Recording</span> — press Esc to cancel';
  btnEl.textContent = 'Cancel';
  setHotkeyErr('');
  inputEl.focus();
}

function stopCapture(commit) {
  if (!activeCapture) return;
  const { inputEl, btnEl } = activeCapture;
  activeCapture = null;
  btnEl.textContent = 'Record';
  inputEl.placeholder = "Click 'Record' to capture";
  hotkeyHint.textContent = 'Capture any combination — 1, 2, 3 or more keys. Esc cancels, Backspace clears.';
  if (!commit) inputEl.value = previousValueFor(inputEl);
}

function syncSameAsStart() {
  if (sameAsStartBox.checked) {
    stopHotkeyInput.value = startHotkeyInput.value;
    stopHotkeyInput.disabled = true;
    stopRecordBtn.disabled = true;
  } else {
    stopHotkeyInput.disabled = false;
    stopRecordBtn.disabled = false;
  }
}

startRecordBtn.addEventListener('click', () => {
  if (activeCapture && activeCapture.inputEl === startHotkeyInput) {
    stopCapture(false);
  } else {
    startCapture(startHotkeyInput, startRecordBtn);
  }
});

stopRecordBtn.addEventListener('click', () => {
  if (sameAsStartBox.checked) return;
  if (activeCapture && activeCapture.inputEl === stopHotkeyInput) {
    stopCapture(false);
  } else {
    startCapture(stopHotkeyInput, stopRecordBtn);
  }
});

sameAsStartBox.addEventListener('change', () => {
  syncSameAsStart();
  setHotkeyErr('');
});

window.addEventListener('keydown', (e) => {
  if (!activeCapture) return;
  const { inputEl } = activeCapture;
  if (e.key === 'Escape') { e.preventDefault(); stopCapture(false); return; }
  if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
    e.preventDefault();
    inputEl.value = '';
    return;
  }
  const accel = buildAccelerator(e);
  if (!accel) return;
  e.preventDefault();
  inputEl.value = accel;
  if (inputEl === startHotkeyInput) {
    pending.startHotkey = accel;
    if (sameAsStartBox.checked) {
      pending.stopHotkey = accel;
      stopHotkeyInput.value = accel;
    }
  } else {
    pending.stopHotkey = accel;
  }
  stopCapture(true);
});

async function load() {
  const [startHotkey, stopHotkey, language, model, autoPaste, autostart, status] = await Promise.all([
    window.ocApi.getSetting('startHotkey'),
    window.ocApi.getSetting('stopHotkey'),
    window.ocApi.getSetting('language'),
    window.ocApi.getSetting('model'),
    window.ocApi.getSetting('autoPaste'),
    window.ocApi.getSetting('autostart'),
    window.ocApi.whisperStatus().catch(() => ({ binReady: false, modelReady: false })),
  ]);
  pending = {
    startHotkey: startHotkey || DEFAULTS.startHotkey,
    stopHotkey: stopHotkey || DEFAULTS.stopHotkey,
    language,
    model,
    autoPaste,
    autostart: !!autostart,
  };
  startHotkeyInput.value = pending.startHotkey;
  stopHotkeyInput.value = pending.stopHotkey;
  sameAsStartBox.checked = pending.startHotkey === pending.stopHotkey;
  syncSameAsStart();
  languageSel.value = language || 'auto';
  modelSel.value = model || 'small';
  autoPasteBox.checked = autoPaste !== false;
  autostartBox.checked = !!autostart;

  if (!status.binReady) {
    modelHint.textContent = 'Whisper engine not downloaded. Save & Download to fetch it.';
    modelHint.style.color = '#f0c060';
  } else if (status.modelReady) {
    modelHint.textContent = 'Model is downloaded and ready.';
    modelHint.style.color = '#6dd58c';
  } else {
    modelHint.textContent = 'Engine is ready. Selected model will be downloaded when you save.';
    modelHint.style.color = '#9aa0a6';
  }
}

async function save() {
  setHotkeyErr('');
  const same = sameAsStartBox.checked;
  const startAccel = startHotkeyInput.value || pending.startHotkey;
  const stopAccel = same ? startAccel : (stopHotkeyInput.value || pending.stopHotkey);
  if (!startAccel) {
    setHotkeyErr('Pick a Start shortcut first.');
    return;
  }
  if (!same && startAccel === stopAccel) {
    setHotkeyErr('Start and Stop are identical. Tick "Same as start" for toggle mode, or pick a different Stop shortcut.');
    return;
  }
  pending.startHotkey = startAccel;
  pending.stopHotkey = stopAccel;
  pending.language = languageSel.value;
  pending.model = modelSel.value;
  pending.autoPaste = autoPasteBox.checked;
  pending.autostart = autostartBox.checked;

  saveBtn.disabled = true;
  try {
    await window.ocApi.setSetting('startHotkey', pending.startHotkey);
    await window.ocApi.setSetting('stopHotkey', pending.stopHotkey);
    await window.ocApi.setSetting('language', pending.language);
    await window.ocApi.setSetting('autoPaste', pending.autoPaste);
    await window.ocApi.setSetting('autostart', pending.autostart);
    if (pending.model) {
      await window.ocApi.setSetting('model', pending.model);
      await window.ocApi.downloadWhisper(pending.model);
      setStatus('Saved. Downloading model in the background…', 'ok');
    } else {
      setStatus('Saved.', 'ok');
    }
    setTimeout(() => window.ocApi.hideSettings(), 800);
  } catch (err) {
    setStatus('Save failed: ' + (err && err.message ? err.message : err), 'err');
    saveBtn.disabled = false;
  }
}

saveBtn.addEventListener('click', save);
cancelBtn.addEventListener('click', () => window.ocApi.hideSettings());

load();
