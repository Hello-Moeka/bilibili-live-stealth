'use strict';

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

module.exports = { BLOCKED_URLS, shouldBlock, fakeResponseText, installHttpHook };