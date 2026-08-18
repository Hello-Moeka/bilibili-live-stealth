'use strict';
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { shouldBlock, fakeResponseText, installHttpHook } = require('../src/http-hook.js');

describe('shouldBlock', () => {
  it('拦 data.bilivideo.com/log/web/ 周期心跳 s82Tq', () => {
    assert.strictEqual(shouldBlock('https://data.bilivideo.com/log/web/s82Tq'), true);
  });
  it('拦 data.bilivideo.com/log/web/ 进房首包 te9Kl', () => {
    assert.strictEqual(shouldBlock('https://data.bilivideo.com/log/web/te9Kl'), true);
  });
  it('放行 getInfoByUser(改参数不阻断)', () => {
    assert.strictEqual(shouldBlock('https://api.live.bilibili.com/xlive/web-room/v1/index/getInfoByUser?room_id=123'), false);
  });
  it('放行无关请求', () => {
    assert.strictEqual(shouldBlock('https://api.bilibili.com/x/web-interface/view'), false);
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
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://live.bilibili.com/123' });
    return dom.window;
  }
  function stubXhr() {
    let realOpened = false;
    function XHR() { this.readyState = 0; this._listeners = {}; }
    XHR.prototype.open = function (m, u) { this._url = u; };
    XHR.prototype.send = function () { realOpened = true; };
    XHR.prototype.setRequestHeader = function () {};
    XHR.prototype.addEventListener = function (t, cb) { (this._listeners[t] = this._listeners[t] || []).push(cb); };
    XHR.prototype.dispatchEvent = function (ev) { (this._listeners[ev && ev.type] || []).forEach(cb => { try { cb(ev); } catch (e) {} }); };
    return { XHR, wasOpened: () => realOpened };
  }

  it('隐身开启:拦心跳 s82Tq,不真发,返回伪造响应', (done) => {
    const win = makeWin();
    const { XHR, wasOpened } = stubXhr();
    win.XMLHttpRequest = XHR;
    const cfg = { getStealth: () => true };
    let count = 0;
    installHttpHook(win, cfg, () => { count++; });
    const xhr = new win.XMLHttpRequest();
    xhr.onload = function () {
      try {
        assert.strictEqual(wasOpened(), false);
        assert.strictEqual(count, 1);
        assert.strictEqual(JSON.parse(xhr.responseText).code, 0);
        done();
      } catch (e) { done(e); }
    };
    xhr.onreadystatechange = function () {};
    xhr.open('POST', 'https://data.bilivideo.com/log/web/s82Tq');
    xhr.send();
  });

  it('隐身关闭:放行不拦', () => {
    const win = makeWin();
    const { XHR, wasOpened } = stubXhr();
    win.XMLHttpRequest = XHR;
    const cfg = { getStealth: () => false };
    installHttpHook(win, cfg, () => {});
    const xhr = new win.XMLHttpRequest();
    xhr.open('POST', 'https://data.bilivideo.com/log/web/s82Tq');
    xhr.send();
    assert.strictEqual(wasOpened(), true);
  });
});

describe('installHttpHook (fetch)', () => {
  function makeWin() {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://live.bilibili.com/123' });
    return dom.window;
  }
  function stubResponse() {
    function Response(text, init) { this._text = text; this.status = (init && init.status) || 200; }
    Response.prototype.text = function () { return Promise.resolve(this._text); };
    return Response;
  }

  it('隐身开启:getInfoByUser 的 room_id 被换成假号 27227', async () => {
    const win = makeWin();
    win.Response = stubResponse();
    let capturedUrl = null;
    // 先设 fetch 桩,再 install(hook 会包裹这个桩,内部调它)
    win.fetch = async function (input, init) { capturedUrl = typeof input === 'string' ? input : (input && input.url); return new win.Response('{}'); };
    const cfg = { getStealth: () => true };
    installHttpHook(win, cfg, () => {});
    await win.fetch('https://api.live.bilibili.com/xlive/web-room/v1/index/getInfoByUser?room_id=123&from=0&not_mock_enter_effect=0');
    assert.ok(capturedUrl && capturedUrl.includes('room_id=27227'), 'room_id 应被换成 27227, got: ' + capturedUrl);
  });

  it('隐身开启:getDanmuInfo 请求 credentials 被设为 omit', async () => {
    const win = makeWin();
    win.Response = stubResponse();
    let capturedInit = null;
    win.fetch = async function (input, init) { capturedInit = init || {}; return new win.Response('{}'); };
    const cfg = { getStealth: () => true };
    installHttpHook(win, cfg, () => {});
    await win.fetch('https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?room_id=123', {});
    assert.strictEqual(capturedInit.credentials, 'omit');
  });

  it('隐身开启:拦心跳 s82Tq,返回伪造 Response', async () => {
    const win = makeWin();
    win.Response = stubResponse();
    let realCalled = false;
    win.fetch = async () => { realCalled = true; return new win.Response('{}'); };
    const cfg = { getStealth: () => true };
    installHttpHook(win, cfg, () => {});
    const res = await win.fetch('https://data.bilivideo.com/log/web/s82Tq');
    assert.strictEqual(realCalled, false);
    const text = await res.text();
    assert.strictEqual(JSON.parse(text).code, 0);
  });
});