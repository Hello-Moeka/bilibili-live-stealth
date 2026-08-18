'use strict';

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
    if (!p) { console.log('[BLS-rewrite] parsePacket 返回 null'); return null; }
    if (p.op !== 7) { console.log('[BLS-rewrite] op 不是7,是 ' + p.op); return null; }
    const json = bodyToJson(p.body);
    if (!json) { console.log('[BLS-rewrite] bodyToJson 返回 null, bodyLen=' + p.body.length); return null; }
    if (!('uid' in json)) { console.log('[BLS-rewrite] body 无 uid 字段, keys=' + Object.keys(json)); return null; }
    console.log('[BLS-rewrite] 找到 uid=' + json.uid + ' 即将改 ' + newUid);
    json.uid = newUid;
    return buildPacket(7, JSON.stringify(json), p.protoVer, p.seq);
  } catch (e) {
    console.log('[BLS-rewrite] 异常: ' + e.message);
    return null;
  }
}

// 安装 WS hook:改写 op=7 uid=0(隐身开启时);每次改写调 onIntercept
function installWsHook(win, cfg, onIntercept) {
  const Orig = win.WebSocket;
  if (!Orig) return;

  const Proxied = new Proxy(Orig, {
    construct(target, args) {
      console.log('[BLS] new WebSocket 被拦截, url=' + args[0]);
      const ws = Reflect.construct(target, args);
      const origSend = ws.send ? ws.send.bind(ws) : null;
      if (origSend) {
        ws.send = function (data) {
          try {
            if (cfg.getStealth()) {
              // 全量诊断:打印 data 类型、长度、op、body、改写结果
              let dtype = Object.prototype.toString.call(data);
              let dlen = (data && data.byteLength != null) ? data.byteLength : (data && data.length != null) ? data.length : -1;
              let opStr = '?', bodyText = '';
              try {
                let bytes;
                if (data instanceof Uint8Array) bytes = data;
                else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
                else if (data && data.buffer && ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
                if (bytes && bytes.length >= 16) {
                  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                  opStr = String(dv.getUint32(8));
                  bodyText = new TextDecoder('utf-8').decode(bytes.slice(16, dv.getUint32(0))).slice(0, 200);
                }
              } catch(e) { bodyText = '解析异常:' + e.message; }
              console.log('[BLS] ws.send type=' + dtype + ' len=' + dlen + ' op=' + opStr + ' body=' + bodyText);

              const rewritten = rewriteAuthPacket(data, 0);
              if (rewritten) {
                console.log('[BLS] op=7 已改写 uid=0 ✓');
                onIntercept && onIntercept();
                return origSend(rewritten);
              } else {
                console.log('[BLS] 改写返回 null(原样透传)');
              }
            }
          } catch (e) { console.warn('[BLS] WS hook 异常', e); /* 任何异常原样透传 */ }
          return origSend(data);
        };
      }
      return ws;
    }
  });

  win.WebSocket = Proxied;
}

module.exports = { rewriteAuthPacket, installWsHook };