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

const moduleNames = ['http-hook.js', 'ws-hook.js'];
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
// @version      2.0.0
// @description  隐身看B站直播:主播看不到你进房,你不出现在在线列表,弹幕正常。
// @author       anonymous
// @match        *://live.bilibili.com/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==
`;

const entry = `
  var win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

  // 隐身恒开,无需开关
  var cfg = { getStealth: function () { return true; } };
  var interceptCount = 0;
  var onIntercept = function () { interceptCount++; };

  try { httpHook.installHttpHook(win, cfg, onIntercept); } catch (e) { console.warn('[BLS] HTTP hook 失败', e); }
  try { wsHook.installWsHook(win, cfg, onIntercept); } catch (e) { console.warn('[BLS] WS hook 失败', e); }
`;

const out = header + '\n(function () {\n  \'use strict\';\n' + wrapped + '\n\n' + entry + '\n})();\n';

fs.writeFileSync(path.join(__dirname, 'bilibili-live-stealth.user.js'), out, 'utf8');
console.log('built bilibili-live-stealth.user.js (' + out.length + ' bytes)');