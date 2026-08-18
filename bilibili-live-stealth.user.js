// ==UserScript==
// @name         B站直播隐身观看
// @namespace    https://github.com/local/bilibili-live-stealth
// @version      2.0.0
// @description  隐身看B站直播:主播看不到你进房,你不出现在在线列表,弹幕正常。
// @author       anonymous
// @match        *://live.bilibili.com/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';
  var httpHook = (function () {
    var module = { exports: {} };
// 阻断列表:命中则不真发,伪造成功响应(在线心跳,不需要服务端响应)
const BLOCKED_URLS = [
  'data.bilivideo.com/log/web/'   // 在线心跳:te9Kl(进房首包+签名校验)、s82Tq(周期心跳)
];

// getInfoByUser 的 room_id 换成假号 27227:服务端以为你进假房间,不广播进房,但仍返回有效响应
const FAKE_ROOM = '27227';

function shouldBlock(url) {
  if (!url || typeof url !== 'string') return false;
  return BLOCKED_URLS.some(u => url.includes(u));
}

function fakeResponseText() {
  return '{"code":0,"message":"OK","data":{}}';
}

// 包裹 XHR 与 fetch
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
    // 捕获弹幕 history API URL,供 ws-hook 弹幕脱敏修复使用
    try {
      if (cfg.getStealth() && url && String(url).includes('history') && !String(url).includes('|')) {
        win.__blsHistoryApi = String(url);
      }
    } catch (e) {}
    return origOpen.apply(this, arguments);
  };

  Orig.prototype.send = function (body) {
    if (cfg.getStealth() && shouldBlock(this.__bls_url)) {
      try {
        onIntercept && onIntercept();
        const fake = fakeResponseText();
        const self = this;
        const props = ['readyState', 'status', 'responseText', 'response'];
        for (const p of props) {
          try { Object.defineProperty(self, p, { configurable: true, writable: true }); } catch (e) {}
        }
        self.readyState = 4;
        self.status = 200;
        self.responseText = fake;
        self.response = fake;
        try { self.dispatchEvent(new win.Event('readystatechange')); } catch (e) {}
        try { self.dispatchEvent(new win.Event('load')); } catch (e) {}
        if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
        if (typeof self.onload === 'function') self.onload();
        return;
      } catch (e) { /* 失败降级:真发 */ }
    }
    return origSend.apply(this, arguments);
  };
}

function wrapFetch(win, cfg, onIntercept) {
  const Orig = win.fetch;
  if (!Orig) return;
  win.fetch = function (input, init) {
    let url = typeof input === 'string' ? input : (input && input.url) || '';

    if (cfg.getStealth()) {
      // getInfoByUser:把真实 room_id 换成假号,服务端不广播进房
      if (typeof input === 'string' && input.includes('getInfoByUser')) {
        const m = win.location.pathname.match(/^\/(\d+)/);
        if (m && m[1] !== FAKE_ROOM) {
          input = input.replace(new RegExp('room_id=' + m[1]), 'room_id=' + FAKE_ROOM);
          onIntercept && onIntercept();
        }
      }
      // getDanmuInfo:不带 cookie,拿游客弹幕 token
      if (typeof input === 'string' && input.includes('getDanmuInfo')) {
        init = init || {};
        init.credentials = 'omit';
        onIntercept && onIntercept();
      }
      // 在线心跳:阻断
      if (shouldBlock(url)) {
        onIntercept && onIntercept();
        const text = fakeResponseText();
        if (typeof win.Response === 'function') {
          try { return Promise.resolve(new win.Response(text, { status: 200, headers: { 'content-type': 'application/json' } })); } catch (e) {}
        }
        return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(text); }, json: function () { return Promise.resolve(JSON.parse(text)); } });
      }
    }
    return Orig.call(this, input, init);
  };
}

module.exports = { BLOCKED_URLS, shouldBlock, fakeResponseText, installHttpHook };
    return module.exports;
  })();

  var wsHook = (function () {
    var module = { exports: {} };
// 内联 packet 模块的关键函数(避免构建内联后跨模块引用断裂)
const HEADER_LEN = 16;
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
function buildPacket(op, body, protoVer, seq) {
  if (protoVer === undefined) protoVer = 1;
  if (seq === undefined) seq = 1;
  const bodyBytes = body instanceof Uint8Array ? body : new TextEncoder().encode(String(body));
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
function bodyToJson(body) {
  try {
    const text = new TextDecoder('utf-8').decode(body);
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

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

// 弹幕脱敏修复:uid=0 会让收到的弹幕用户名脱敏(变*),用 history API 查回真实用户名补上
function startDanmakuRepair(win, getHistoryApi) {
  const doc = win.document;
  function reviseDanmakuName(el, retry) {
    const api = getHistoryApi();
    if (!api || retry >= 5) return;
    try {
      const xhr = new win.XMLHttpRequest();
      xhr.open('GET', api);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4 || xhr.status !== 200) return;
        try {
          const json = JSON.parse(xhr.responseText);
          const list = json && json.data && json.data.room;
          if (!json || json.code !== 0 || !Array.isArray(list)) return;
          let done = false;
          for (let i = list.length - 1; i >= 0; i--) {
            const item = list[i];
            if (el.getAttribute('data-ct') === (item && item.check_info && item.check_info.ct)) {
              const attrs = el.getAttributeNames();
              if (attrs[1]) el.setAttribute(attrs[1], item.nickname);
              if (attrs[5]) el.setAttribute(attrs[5], item.uid);
              const name = el.getElementsByClassName('user-name')[0];
              if (name) name.textContent = item.nickname + ' : ';
              done = true;
              break;
            }
          }
          if (!done) setTimeout(function () { reviseDanmakuName(el, retry + 1); }, 1000);
        } catch (e) {}
      };
      xhr.send();
    } catch (e) {}
  }

  function observeChat() {
    const container = doc.getElementById('chat-items');
    if (!container) return false;
    new win.MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (el) {
          try {
            if (!el || !el.classList || !el.classList.value || !el.classList.value.includes('danmaku')) return;
            const ct = el.getAttribute('data-ct');
            if (ct != null && ct.length === 0) el.style.display = 'none';
            const attrs = el.getAttributeNames();
            if (attrs[5] && el.getAttribute(attrs[5]) === '0') reviseDanmakuName(el, 0);
          } catch (e) {}
        });
      });
    }).observe(container, { childList: true });
    return true;
  }

  if (!observeChat()) {
    const timer = win.setInterval(function () {
      if (observeChat()) win.clearInterval(timer);
    }, 1000);
    setTimeout(function () { win.clearInterval(timer); }, 15000);
  }
}

// 安装 WS hook:改写 op=7 uid=0(隐身开启时);每次改写调 onIntercept;修复脱敏弹幕
function installWsHook(win, cfg, onIntercept) {
  const Orig = win.WebSocket;
  if (!Orig) return;

  const Proxied = new Proxy(Orig, {
    construct(target, args) {
      const ws = Reflect.construct(target, args);
      const origSend = ws.send ? ws.send.bind(ws) : null;
      let historyApi = null;
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
      // 启动弹幕脱敏修复,historyApi 从 win.__blsHistoryApi 动态读取(http-hook 捕获)
      if (cfg.getStealth()) {
        try { startDanmakuRepair(win, function () { return win.__blsHistoryApi || null; }); } catch (e) {}
      }
      return ws;
    }
  });

  win.WebSocket = Proxied;
}

module.exports = { rewriteAuthPacket, installWsHook, parsePacket, buildPacket, bodyToJson };
    return module.exports;
  })();


  var win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

  // 隐身恒开,无需开关
  var cfg = { getStealth: function () { return true; } };
  var interceptCount = 0;
  var onIntercept = function () { interceptCount++; };

  try { httpHook.installHttpHook(win, cfg, onIntercept); } catch (e) { console.warn('[BLS] HTTP hook 失败', e); }
  try { wsHook.installWsHook(win, cfg, onIntercept); } catch (e) { console.warn('[BLS] WS hook 失败', e); }

})();
