'use strict';
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { installUi } = require('../src/ui.js');

function makeWin() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://live.bilibili.com/1' });
  return dom.window;
}

describe('installUi', () => {
  it('注入面板到 body,显示当前隐身状态与计数', () => {
    const win = makeWin();
    const cfg = { getStealth: () => true, setStealth: () => {}, onChange: () => {} };
    installUi(win, cfg, () => 12);
    const panel = win.document.querySelector('#bls-panel');
    assert.ok(panel, '面板应被注入');
    assert.ok(panel.textContent.includes('隐身'));
    assert.ok(panel.textContent.includes('12'));
  });

  it('点开关切换调用 cfg.setStealth,传入相反值', () => {
    const win = makeWin();
    let setCalled = null;
    const cfg = { getStealth: () => true, setStealth: (v) => { setCalled = v; }, onChange: () => {} };
    installUi(win, cfg, () => 0);
    const toggle = win.document.querySelector('#bls-toggle');
    assert.ok(toggle);
    toggle.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(setCalled, false); // 从 true 切到 false
  });

  it('cfg.onChange 触发时面板更新显示', () => {
    const win = makeWin();
    let changeCb = null;
    const cfg = { getStealth: () => true, setStealth: () => {}, onChange: (cb) => { changeCb = cb; } };
    installUi(win, cfg, () => 0);
    changeCb(false); // 模拟状态变 false
    const status = win.document.querySelector('#bls-status');
    assert.ok(status.textContent.includes('关'));
  });
});