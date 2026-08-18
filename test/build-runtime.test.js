'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

// 真正在 jsdom 环境里执行构建产物,验证脚本能跑通且 hook 装上
// 这是之前缺的测试:之前只验证文件存在/文本包含,没验证产物逻辑
function runBuiltScript() {
  const file = path.join(__dirname, '..', 'bilibili-live-stealth.user.js');
  const code = fs.readFileSync(file, 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://live.bilibili.com/123',
    pretendToBeVisual: true
  });
  const win = dom.window;
  // 模拟无 GM_* 环境,走 localStorage 分支
  const sandbox = {
    window: win,
    unsafeWindow: win,
    document: win.document,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    localStorage: win.localStorage,
    setInterval: () => 0,
    TextEncoder: win.TextEncoder,
    TextDecoder: win.TextDecoder,
    Proxy: win.Proxy,
    Reflect: win.Reflect,
    Uint8Array: win.Uint8Array,
    DataView: win.DataView,
    Map: win.Map,
    TextEncoder: win.TextEncoder,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { win, sandbox };
}

describe('build 产物可执行性', () => {
  it('脚本执行不抛错(模块导出非空,装配成功)', () => {
    // 应能执行且不抛 config.createConfig is not a function 之类
    assert.doesNotThrow(() => runBuiltScript());
  });

  it('XHR.send 命中 roomEntryAction 时被拦截不真发', () => {
    const { win } = runBuiltScript();
    // 真实 XHR 会被 hook 的 prototype.send 接管
    const xhr = new win.XMLHttpRequest();
    let calledOnload = false;
    xhr.onload = function () { calledOnload = true; };
    xhr.onreadystatechange = function () {};
    // open 不真发网络(jsdom 默认不连网);我们只验证 hook 伪造了响应
    let intercepted = false;
    try {
      xhr.open('POST', 'https://api.live.bilibili.com/xlive/web-room/v1/index/roomEntryAction');
      xhr.send();
    } catch (e) {
      // jsdom open 可能抛跨域,但 hook 在 send 阶段拦截;若已抛说明 hook 没接管
    }
    // hook 命中应伪造 readyState=4 + responseText
    assert.strictEqual(xhr.readyState, 4, 'XHR 应被 hook 伪造为 readyState 4');
    assert.strictEqual(JSON.parse(xhr.responseText).code, 0, '应返回伪造 code:0');
    assert.ok(calledOnload, 'onload 应被触发');
  });
});