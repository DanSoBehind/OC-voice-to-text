const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'electron') return require.resolve('./electron-stub.js');
  return origResolve.call(this, request, parent, ...rest);
};

const whisper = require('../src/whisper');

(async () => {
  console.log('ensuring BLAS binary...');
  const t0 = Date.now();
  const bin = await whisper.ensureBinary((d, t) => {
    const pct = (d / t * 100).toFixed(0);
    if (d % (5 * 1024 * 1024) < 100000) process.stdout.write(`\rdownloading: ${pct}%   `);
  });
  console.log('\nbinary at:', bin, 'in', Date.now() - t0, 'ms');
  const size = require('fs').statSync(bin).size;
  console.log('size:', size, 'bytes');

  whisper.stopServer();
  process.exit(0);
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
