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
      const ws = Reflect.construct(target, args);
      const origSend = ws.send ? ws.send.bind(ws) : null;
      if (origSend) {
        ws.send = function (data) {
          try {
            if (cfg.getStealth()) {
              // 诊断:打印所有 send 的包 op 与原始内容(帮助定位进房包结构)
              const bytes = data instanceof Uint8Array ? data : (data && ArrayBuffer.isView(data)) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
              if (bytes && bytes.length >= 16) {
                const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                const op = dv.getUint32(8);
                if (op === 7 || op === 2) {
                  let bodyText = '';
                  try { bodyText = new TextDecoder('utf-8').decode(bytes.slice(16, dv.getUint32(0))); } catch(e){}
                  console.log('[BLS] WS send op=' + op + ' len=' + bytes.length + ' body=' + bodyText.slice(0, 300));
                }
              }
              const rewritten = rewriteAuthPacket(data, 0);
              if (rewritten) {
                console.log('[BLS] op=7 已改写 uid=0');
                onIntercept && onIntercept();
                return origSend(rewritten);
              } else {
                console.log('[BLS] op=7 改写返回 null(原样透传,可能包结构已变)');
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