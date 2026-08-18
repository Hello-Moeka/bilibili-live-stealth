'use strict';
const assert = require('assert');
const { createConfig } = require('../src/config.js');

function fakeStorage() {
  const m = new Map();
  return { getValue: (k, d) => m.has(k) ? m.get(k) : d, setValue: (k, v) => m.set(k, v) };
}

describe('config', () => {
  it('默认隐身开启', () => {
    const cfg = createConfig(fakeStorage());
    assert.strictEqual(cfg.getStealth(), true);
  });
  it('关闭后持久化', () => {
    const store = fakeStorage();
    const cfg = createConfig(store);
    cfg.setStealth(false);
    assert.strictEqual(store.getValue('bls_stealth', true), false);
    assert.strictEqual(cfg.getStealth(), false);
  });
  it('切换触发 onChange 回调,传入新值', () => {
    const cfg = createConfig(fakeStorage());
    let seen = null;
    cfg.onChange(v => { seen = v; });
    cfg.setStealth(false);
    assert.strictEqual(seen, false);
    cfg.setStealth(true);
    assert.strictEqual(seen, true);
  });
  it('读已保存的 false', () => {
    const store = fakeStorage();
    store.setValue('bls_stealth', false);
    const cfg = createConfig(store);
    assert.strictEqual(cfg.getStealth(), false);
  });
});