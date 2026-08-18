'use strict';
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { rewriteAuthPacket, installWsHook, buildPacket, parsePacket, bodyToJson } = require('../src/ws-hook.js');
const enc = new TextEncoder();

describe('rewriteAuthPacket', () => {
  it('改写 op=7 认证包的 uid 为 0', () => {
    const body = enc.encode(JSON.stringify({ uid: 12345, roomid: 23058, protover: 3, platform: 'web', type: 2, key: 'abc' }));
    const pkt = buildPacket(7, body, 1, 1);
    const rewritten = rewriteAuthPacket(pkt, 0);
    assert.ok(rewritten);
    const p = parsePacket(rewritten);
    assert.strictEqual(p.op, 7);
    const json = bodyToJson(p.body);
    assert.strictEqual(json.uid, 0);
    assert.strictEqual(json.roomid, 23058); // 其他字段保留
    assert.strictEqual(json.key, 'abc');
  });

  it('非 op=7 返回 null(不改写)', () => {
    const pkt = buildPacket(2, new Uint8Array(0), 1, 1); // op=2 心跳
    assert.strictEqual(rewriteAuthPacket(pkt, 0), null);
  });

  it('body 非 JSON 返回 null(不改写)', () => {
    const pkt = buildPacket(7, enc.encode('notjson'), 1, 1);
    assert.strictEqual(rewriteAuthPacket(pkt, 0), null);
  });

  it('没有 uid 字段返回 null(不改写)', () => {
    const pkt = buildPacket(7, enc.encode(JSON.stringify({ roomid: 1 })), 1, 1);
    assert.strictEqual(rewriteAuthPacket(pkt, 0), null);
  });
});

describe('installWsHook', () => {
  // 最小 WS 桩:记录每次 send 的原始入参,不连真实网络
  function makeWin() {
    const dom = new JSDOM('', { url: 'https://live.bilibili.com/1' });
    return dom.window;
  }
  function stubWebSocket() {
    function WS(url) {
      this.url = url;
      this.readyState = 1;
      this._sent = [];
      this.send = function (data) { this._sent.push(data); };
      this.onmessage = null;
    }
    return WS;
  }

  it('隐身开启:op=7 的 uid 被改写为 0', () => {
    const win = makeWin();
    win.WebSocket = stubWebSocket();
    const cfg = { getStealth: () => true };
    let count = 0;
    installWsHook(win, cfg, () => { count++; });
    const ws = new win.WebSocket('wss://x/sub');
    const authBody = enc.encode(JSON.stringify({ uid: 12345, roomid: 1, protover: 3, key: 'k' }));
    ws.send(buildPacket(7, authBody, 1, 1));
    assert.strictEqual(count, 1);
    const sent = parsePacket(ws._sent[0]);
    assert.strictEqual(bodyToJson(sent.body).uid, 0);
  });

  it('隐身开启:op=2 心跳原样透传,不计数', () => {
    const win = makeWin();
    win.WebSocket = stubWebSocket();
    const cfg = { getStealth: () => true };
    let count = 0;
    installWsHook(win, cfg, () => { count++; });
    const ws = new win.WebSocket('wss://x/sub');
    ws.send(buildPacket(2, new Uint8Array(0), 1, 1));
    assert.strictEqual(count, 0);
  });

  it('隐身关闭:op=7 原样透传不改写', () => {
    const win = makeWin();
    win.WebSocket = stubWebSocket();
    const cfg = { getStealth: () => false };
    let count = 0;
    installWsHook(win, cfg, () => { count++; });
    const ws = new win.WebSocket('wss://x/sub');
    const authBody = enc.encode(JSON.stringify({ uid: 12345, roomid: 1, protover: 3, key: 'k' }));
    const pkt = buildPacket(7, authBody, 1, 1);
    ws.send(pkt);
    assert.strictEqual(count, 0);
    assert.deepStrictEqual(new Uint8Array(ws._sent[0]), pkt);
  });

  it('非 WS 包格式(字符串 send)原样透传不抛', () => {
    const win = makeWin();
    win.WebSocket = stubWebSocket();
    const cfg = { getStealth: () => true };
    installWsHook(win, cfg, () => {});
    const ws = new win.WebSocket('wss://x/sub');
    ws.send('hello');
    assert.strictEqual(ws._sent[0], 'hello');
  });
});