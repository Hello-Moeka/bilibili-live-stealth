'use strict';
const fs = require('fs');
const path = require('path');

// 读 src 模块并去掉 require 依赖(内联后不再需要 CommonJS 模块解析)
function loadModule(name) {
  let src = fs.readFileSync(path.join(__dirname, 'src', name), 'utf8');
  src = src.replace(/^['"]use strict['"];\s*/, '');
  // 保留 module.exports = {...}; —— IIFE 内有 var module = { exports: {} },
  // 这行会把模块函数挂到 module.exports,return module.exports 才有内容。
  // 去掉 require('./xxx') 行(跨模块依赖靠同 IIFE 内变量提升)
  src = src.replace(/const\s+\{[^}]*\}\s*=\s*require\(['"]\.\/[^'"]+['"]\);?\s*/g, '');
  return { name, src };
}

const moduleNames = ['config.js', 'packet.js', 'http-hook.js', 'ws-hook.js', 'ui.js'];
const mods = moduleNames.map(loadModule);

// 用 IIFE 把各模块包起来,把 module.exports 返回值赋给按文件名命名的全局变量
function camelCase(file) {
  return file.replace(/\.js$/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

const wrapped = mods.map(m => {
  const varName = camelCase(m.name);
  return '  var ' + varName + ' = (function () {\n    var module = { exports: {} };\n' + m.src + '\n    return module.exports;\n  })();';
}).join('\n\n');

const header = `// ==UserScript==
// @name         B站直播隐身观看
// @namespace    https://github.com/local/bilibili-live-stealth
// @version      1.0.0
// @description  隐身看B站直播:主播看不到你进房,你不出现在在线列表,保留粉丝勋章亲密度。带右下角开关。
// @author       anonymous
// @match        *://live.bilibili.com/*
// @match        *://live.bilibili.com/blanc/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==
`;

const entry = `
  var win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

  // 存储后端:优先 GM_*,无则降级 localStorage
  var storage = (typeof GM_setValue !== 'undefined' && typeof GM_getValue !== 'undefined')
    ? { getValue: function (k, d) { return GM_getValue(k, d); }, setValue: function (k, v) { GM_setValue(k, v); } }
    : { getValue: function (k, d) { try { var s = localStorage.getItem(k); return s === null ? d : JSON.parse(s); } catch (e) { return d; } },
        setValue: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

  var interceptCount = 0;
  var onIntercept = function () { interceptCount++; };

  var cfg = config.createConfig(storage);

  try { httpHook.installHttpHook(win, cfg, onIntercept); } catch (e) { console.warn('[BLS] HTTP hook 失败', e); }
  try { wsHook.installWsHook(win, cfg, onIntercept); } catch (e) { console.warn('[BLS] WS hook 失败', e); }

  function startUi() {
    try { ui.installUi(win, cfg, function () { return interceptCount; }); } catch (e) { console.warn('[BLS] UI 失败', e); }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startUi);
  } else {
    startUi();
  }
`;

const out = header + '\n(function () {\n  \'use strict\';\n' + wrapped + '\n\n' + entry + '\n})();\n';

fs.writeFileSync(path.join(__dirname, 'bilibili-live-stealth.user.js'), out, 'utf8');
console.log('built bilibili-live-stealth.user.js (' + out.length + ' bytes)');