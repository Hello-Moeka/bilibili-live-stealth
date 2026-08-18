'use strict';

const KEY = 'bls_stealth';
const DEFAULT = true;

// storage: { getValue(key, default), setValue(key, value) }
function createConfig(storage) {
  let stealth = storage.getValue(KEY, DEFAULT);
  const listeners = [];

  return {
    getStealth() { return stealth; },
    setStealth(v) {
      const b = !!v;
      if (b === stealth) return;
      stealth = b;
      storage.setValue(KEY, b);
      for (const cb of listeners) {
        try { cb(b); } catch (e) { /* 回调失败不影响状态 */ }
      }
    },
    onChange(cb) { listeners.push(cb); }
  };
}

module.exports = { createConfig };