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

module.exports = { rewriteAuthPacket, installWsHook };