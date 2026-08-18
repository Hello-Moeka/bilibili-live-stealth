'use strict';
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { shouldBlock, fakeResponseText, installHttpHook, BLOCKED_URLS } = require('../src/http-hook.js');

describe('shouldBlock', () => {
  it('拦 roomEntryAction(进房上报)', () => {
    assert.strictEqual(shouldBlock('https://api.live.bilibili.com/xlive/web-room/v1/index/roomEntryAction?room_id=1'), true);
  });
  it('拦 data.bilivideo.com/log/web/ 周期心跳 s82Tq', () => {
    assert.strictEqual(shouldBlock('https://data.bilivideo.com/log/web/s82Tq'), true);
  });
  it('拦 data.bilivideo.com/log/web/ 进房首包 te9Kl', () => {
    assert.strictEqual(shouldBlock('https://data.bilivideo.com/log/web/te9Kl'), true);
  });
  it('放行 roomReportAction(播放质量上报,与隐身无关)', () => {
    assert.strictEqual(shouldBlock('https://api.live.bilibili.com/xlive/web-room/v1/index/roomReportAction'), false);
  });
  it('放行无关请求', () => {
    assert.strictEqual(shouldBlock('https://api.bilibili.com/x/web-interface/view'), false);
  });
  it('BLOCKED_URLS 含 roomEntryAction 与 data.bilivideo.com/log/web/', () => {
    assert.ok(BLOCKED_URLS.some(u => u.includes('roomEntryAction')));
    assert.ok(BLOCKED_URLS.some(u => u.includes('data.bilivideo.com/log/web/')));
  });
});

describe('fakeResponseText', () => {
  it('返回 code:0 的成功 JSON', () => {
    const j = JSON.parse(fakeResponseText());
    assert.strictEqual(j.code, 0);
  });
});

describe('installHttpHook (XHR)', () => {
  function makeWin() {
    const dom = new JSDOM('', { url: 'https://live.bilibili.com/1' });
    return dom.window;
  }

  // 桩 XHR:方法放 prototype 上(模拟真实浏览器结构),用闭包标志记录是否真发网络
  function stubXhr() {
    let realOpened = false;
    function XHR() { this.readyState = 0; }
    XHR.prototype.open = function (m, u) { this._url = u; };
    XHR.prototype.send = function () { realOpened = true; /* 不真发 */ };
    XHR.prototype.setRequestHeader = function () {};
    return { XHR, wasOpened: () => realOpened };
  }

  it('隐身开启:拦 roomEntryAction,不真发,返回伪造响应', (done) => {
    const win = makeWin();
    const { XHR, wasOpened } = stubXhr();
    win.XMLHttpRequest = XHR;
    const cfg = { getStealth: () => true };
    let count = 0;
    installHttpHook(win, cfg, () => { count++; });
    const xhr = new win.XMLHttpRequest();
    xhr.onload = function () {
      try {
        assert.strictEqual(wasOpened(), false); // 没真发
        assert.strictEqual(count, 1);
        assert.strictEqual(JSON.parse(xhr.responseText).code, 0);
        done();
      } catch (e) { done(e); }
    };
    xhr.onreadystatechange = function () {};
    xhr.open('POST', 'https://api.live.bilibili.com/xlive/web-room/v1/index/roomEntryAction');
    xhr.send();
  });

  it('隐身关闭:放行不拦', () => {
    const win = makeWin();
    const { XHR, wasOpened } = stubXhr();
    win.XMLHttpRequest = XHR;
    const cfg = { getStealth: () => false };
    let count = 0;
    installHttpHook(win, cfg, () => { count++; });
    const xhr = new win.XMLHttpRequest();
    xhr.open('POST', 'https://api.live.bilibili.com/xlive/web-room/v1/index/roomEntryAction');
    xhr.send();
    assert.strictEqual(wasOpened(), true);
    assert.strictEqual(count, 0);
  });
});

describe('installHttpHook (fetch)', () => {
  function makeWin() {
    const dom = new JSDOM('', { url: 'https://live.bilibili.com/1' });
    return dom.window;
  }
  // jsdom 不提供全局 Response,用最小桩
  function stubResponse() {
    function Response(text, init) { this._text = text; this.status = (init && init.status) || 200; }
    Response.prototype.text = function () { return Promise.resolve(this._text); };
    return Response;
  }
  it('隐身开启:拦周期心跳 s82Tq,返回伪造 Response', async () => {
    const win = makeWin();
    win.Response = stubResponse();
    let realCalled = false;
    win.fetch = async () => { realCalled = true; return new win.Response('{}'); };
    const cfg = { getStealth: () => true };
    let count = 0;
    installHttpHook(win, cfg, () => { count++; });
    const res = await win.fetch('https://data.bilivideo.com/log/web/s82Tq');
    assert.strictEqual(realCalled, false);
    assert.strictEqual(count, 1);
    const text = await res.text();
    assert.strictEqual(JSON.parse(text).code, 0);
  });
});