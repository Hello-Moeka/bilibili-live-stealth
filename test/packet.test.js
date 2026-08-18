'use strict';
const assert = require('assert');
const { parsePacket, buildPacket, bodyToJson } = require('../src/packet.js');
const enc = new TextEncoder();

describe('packet', () => {
  it('buildPacket + parsePacket 往返保持 op 与 body', () => {
    const body = enc.encode(JSON.stringify({ uid: 12345, roomid: 23058 }));
    const pkt = buildPacket(7, body, 1, 1); // op=7 认证包
    const parsed = parsePacket(pkt);
    assert.strictEqual(parsed.op, 7);
    assert.strictEqual(parsed.protoVer, 1);
    assert.strictEqual(parsed.seq, 1);
    assert.deepStrictEqual(parsed.body, body);
  });

  it('bodyToJson 解出 JSON', () => {
    const body = enc.encode('{"uid":42,"roomid":1}');
    assert.deepStrictEqual(bodyToJson(body), { uid: 42, roomid: 1 });
  });

  it('bodyToJson 非 JSON 返回 null', () => {
    const body = enc.encode('not json');
    assert.strictEqual(bodyToJson(body), null);
  });

  it('parsePacket 头不全返回 null', () => {
    assert.strictEqual(parsePacket(new Uint8Array(10)), null);
  });

  it('parsePacket 长度不足返回 null', () => {
    // 声称长 100 但只给 20 字节
    const fake = new Uint8Array(20);
    const dv = new DataView(fake.buffer);
    dv.setUint32(0, 100); // packetLength=100
    dv.setUint16(4, 16);  // headerLength=16
    dv.setUint16(6, 1);    // protoVer
    dv.setUint32(8, 2);    // op
    dv.setUint32(12, 1);   // seq
    assert.strictEqual(parsePacket(fake), null);
  });

  it('心跳包 body 可为空', () => {
    const pkt = buildPacket(2, new Uint8Array(0), 1, 1);
    const parsed = parsePacket(pkt);
    assert.strictEqual(parsed.op, 2);
    assert.strictEqual(parsed.body.length, 0);
  });
});