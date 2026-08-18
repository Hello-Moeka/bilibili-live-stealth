'use strict';
const { parsePacket, buildPacket, bodyToJson } = require('./packet.js');

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