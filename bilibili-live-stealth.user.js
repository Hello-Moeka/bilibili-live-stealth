// ==UserScript==
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

(function () {
  'use strict';
  var config = (function () {
    var module = { exports: {} };
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


    return module.exports;
  })();

  var packet = (function () {
    var module = { exports: {} };
const HEADER_LEN = 16;

// 解析一个 WS 包头;返回字段对象,或 null(数据不足/头不全)
function parsePacket(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < HEADER_LEN) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const packetLength = dv.getUint32(0);
  const headerLength = dv.getUint16(4);
  const protoVer = dv.getUint16(6);
  const op = dv.getUint32(8);
  const seq = dv.getUint32(12);
  if (bytes.length < packetLength) return null;
  const body = bytes.slice(headerLength, packetLength);
  return { packetLength, headerLength, protoVer, op, seq, body };
}

// 拼一个 WS 包;body 可为 Uint8Array 或 string(按 UTF-8 编码)
function buildPacket(op, body, protoVer = 1, seq = 1) {
  const bodyBytes = body instanceof Uint8Array
    ? body
    : new TextEncoder().encode(String(body));
  const total = HEADER_LEN + bodyBytes.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, total);
  dv.setUint16(4, HEADER_LEN);
  dv.setUint16(6, protoVer);
  dv.setUint32(8, op);
  dv.setUint32(12, seq);
  out.set(bodyBytes, HEADER_LEN);
  return out;
}

// 把 body 当 UTF-8 JSON 解析;失败返回 null
function bodyToJson(body) {
  try {
    const text = new TextDecoder('utf-8').decode(body);
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}


    return module.exports;
  })();

  var httpHook = (function () {
    var module = { exports: {} };
const BLOCKED_URLS = [
  '/xlive/web-room/v1/index/roomEntryAction',
  '/xlive/rdata-interface/v1/heartbeat/webHeartBeat'
];

function shouldBlock(url) {
  if (!url || typeof url !== 'string') return false;
  return BLOCKED_URLS.some(u => url.includes(u));
}

function fakeResponseText() {
  return '{"code":0,"message":"OK","data":{}}';
}

// 包裹 XHR 与 fetch;命中拦截则伪造成功响应不真发,调 onIntercept
function installHttpHook(win, cfg, onIntercept) {
  wrapXhr(win, cfg, onIntercept);
  wrapFetch(win, cfg, onIntercept);
}

function wrapXhr(win, cfg, onIntercept) {
  const Orig = win.XMLHttpRequest;
  if (!Orig) return;
  const origOpen = Orig.prototype.open;
  const origSend = Orig.prototype.send;

  Orig.prototype.open = function (method, url) {
    this.__bls_url = url;
    return origOpen.apply(this, arguments);
  };

  Orig.prototype.send = function (body) {
    if (cfg.getStealth() && shouldBlock(this.__bls_url)) {
      try {
        onIntercept && onIntercept();
        const fake = fakeResponseText();
        // 伪造 readyState 与响应,触发回调
        this.readyState = 4;
        this.status = 200;
        this.responseText = fake;
        this.response = fake;
        const self = this;
        if (typeof self.onreadystatechange === 'function') {
          self.onreadystatechange();
        }
        if (typeof self.onload === 'function') {
          self.onload();
        }
        return;
      } catch (e) { /* 失败降级:真发 */
      }
    }
    return origSend.apply(this, arguments);
  };
}

function wrapFetch(win, cfg, onIntercept) {
  const Orig = win.fetch;
  if (!Orig) return;
  win.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (cfg.getStealth() && shouldBlock(url)) {
      onIntercept && onIntercept();
      const text = fakeResponseText();
      const res = new win.Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
      return Promise.resolve(res);
    }
    return Orig.apply(this, arguments);
  };
}


    return module.exports;
  })();

  var wsHook = (function () {
    var module = { exports: {} };
// 改写 op=7 认证包里的 uid;成功返回新 Uint8Array,否则 null(调用方应原样透传)
function rewriteAuthPacket(buf, newUid) {
  try {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const p = parsePacket(bytes);
    if (!p || p.op !== 7) return null;
    const json = bodyToJson(p.body);
    if (!json || !('uid' in json)) return null;
    json.uid = newUid;
    return buildPacket(7, JSON.stringify(json), p.protoVer, p.seq);
  } catch (e) {
    return null;
  }
}

// 安装 WS hook:改写 op=7 uid=0(隐身开启时);每次改写调 onIntercept
function installWsHook(win, cfg, onIntercept) {
  const Orig = win.WebSocket;
  if (!Orig) return;

  const Proxied = new Proxy(Orig, {
    construct(target, args) {
      const ws = Reflect.construct(target, args);
      const origSend = ws.send ? ws.send.bind(ws) : null;
      if (origSend) {
        ws.send = function (data) {
          try {
            if (cfg.getStealth()) {
              const rewritten = rewriteAuthPacket(data, 0);
              if (rewritten) {
                onIntercept && onIntercept();
                return origSend(rewritten);
              }
            }
          } catch (e) { /* 任何异常原样透传 */ }
          return origSend(data);
        };
      }
      return ws;
    }
  });

  win.WebSocket = Proxied;
}


    return module.exports;
  })();

  var ui = (function () {
    var module = { exports: {} };
function installUi(win, cfg, getInterceptCount) {
  const doc = win.document;
  if (!doc || !doc.body) {
    // body 还没就绪,等 DOMContentLoaded
    doc.addEventListener('DOMContentLoaded', () => inject(win, cfg, getInterceptCount), { once: true });
    return;
  }
  inject(win, cfg, getInterceptCount);
}

function inject(win, cfg, getInterceptCount) {
  const doc = win.document;
  if (doc.querySelector('#bls-panel')) return; // 防重复

  const panel = doc.createElement('div');
  panel.id = 'bls-panel';
  panel.setAttribute('style', [
    'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
    'padding:8px 12px', 'background:rgba(30,30,35,0.9)', 'color:#fff',
    'border-radius:8px', 'font:12px/1.5 sans-serif', 'box-shadow:0 2px 8px rgba(0,0,0,0.4)',
    'cursor:default', 'user-select:none', 'border:1px solid rgba(255,255,255,0.15)'
  ].join(';') + ';');

  const status = doc.createElement('span');
  status.id = 'bls-status';
  status.textContent = cfg.getStealth() ? '隐身 [开]' : '隐身 [关]';
  status.style.cursor = 'pointer';
  status.style.marginRight = '8px';

  const toggle = doc.createElement('span');
  toggle.id = 'bls-toggle';
  toggle.textContent = '⚙';
  toggle.style.cursor = 'pointer';
  toggle.title = '点击切换隐身开关';

  const countLine = doc.createElement('div');
  countLine.id = 'bls-count';
  countLine.style.fontSize = '11px';
  countLine.style.opacity = '0.8';
  countLine.textContent = '拦截: ' + getInterceptCount() + ' 次';

  // 点击状态或齿轮都切换
  function onToggle() {
    cfg.setStealth(!cfg.getStealth());
  }
  status.addEventListener('click', onToggle);
  toggle.addEventListener('click', onToggle);

  // 状态变化时刷新显示
  cfg.onChange((v) => {
    status.textContent = v ? '隐身 [开]' : '隐身 [关]';
  });

  // 周期刷新计数
  setInterval(() => {
    countLine.textContent = '拦截: ' + getInterceptCount() + ' 次';
  }, 2000);

  panel.appendChild(status);
  panel.appendChild(toggle);
  panel.appendChild(countLine);
  doc.body.appendChild(panel);
}


    return module.exports;
  })();


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

})();
