const { sendCtrlV } = require('../src/paste');
console.log('sending Ctrl+V via SendKeys...');
sendCtrlV().then((res) => {
  console.log('result code:', res.code, 'stderr:', JSON.stringify(res.stderr || ''));
  process.exit(0);
}).catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
