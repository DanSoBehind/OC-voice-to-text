const path = require('path');
const os = require('os');
const appData = path.join(process.env.APPDATA || os.homedir(), 'oc-voice-to-text');
module.exports = {
  app: {
    getPath: (name) => name === 'userData' ? appData : os.tmpdir(),
  },
};
