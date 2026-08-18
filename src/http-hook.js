'use strict';

// 阻断列表:命中则不真发,伪造成功响应(在线心跳,不需要服务端响应)
const BLOCKED_URLS = [
  'data.bilivideo.com/log/web/' // 在线心跳:te9Kl(进房首包+签名校验)、s82Tq(周期心跳)
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