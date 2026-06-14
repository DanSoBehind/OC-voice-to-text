const { spawn } = require('child_process');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendCtrlV() {
  return new Promise((resolve) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')",
    ], { windowsHide: true });
    let stderr = '';
    ps.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    ps.on('close', (code) => resolve({ code, stderr }));
    ps.on('error', (err) => resolve({ code: -1, stderr: String(err) }));
  });
}

async function pasteText(text, { delayMs = 80 } = {}) {
  if (delayMs > 0) await sleep(delayMs);
  return sendCtrlV();
}

module.exports = { sendCtrlV, pasteText };
