const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  startHotkey: 'CommandOrControl+Shift+Space',
  stopHotkey: 'CommandOrControl+Shift+Space',
  model: 'small',
  autoPaste: true,
  language: 'auto',
  autostart: false,
  binaryBuild: '',
  sampleRate: 16000,
};

let cache = null;
let settingsPath = null;

function getPath() {
  if (!settingsPath) {
    settingsPath = path.join(app.getPath('userData'), 'settings.json');
  }
  return settingsPath;
}

function load() {
  if (cache) return cache;
  const file = getPath();
  let parsed = {};
  let existed = false;
  try {
    if (fs.existsSync(file)) {
      existed = true;
      const raw = fs.readFileSync(file, 'utf8');
      parsed = JSON.parse(raw);
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
  let migrated = false;
  if (parsed.hotkey && !parsed.startHotkey) {
    parsed.startHotkey = parsed.hotkey;
    parsed.stopHotkey = parsed.hotkey;
    delete parsed.hotkey;
    migrated = true;
  }
  cache = { ...DEFAULTS, ...parsed };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!existed || migrated) {
      fs.writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8');
    }
  } catch (err) {
    console.error('Failed to write settings:', err);
  }
  return cache;
}

function save(next) {
  cache = { ...load(), ...next };
  const file = getPath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
  return cache;
}

function get(key) {
  const all = load();
  if (key === 'hotkey') return all.startHotkey;
  return key ? all[key] : all;
}

function set(key, value) {
  return save({ [key]: value });
}

module.exports = { load, save, get, set, DEFAULTS };
