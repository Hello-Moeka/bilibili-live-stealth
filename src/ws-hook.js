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
// history API 返回整房近期弹幕列表,多条脱敏弹幕共享一次请求结果,缓存 60 秒,请求级别重试。
function startDanmakuRepair(win, getHistoryApi) {
  const doc = win.document;

  // history 响应缓存:同一房间近期弹幕列表变化不大,一次请求的结果供多条脱敏弹幕复用。
  // historyCache: { ctMap: Map<ct, {uid, name}>, timestamp, api }
  let historyCache = null;
  // 进行中的 history 请求:多条脱敏弹幕合并到同一次请求(批量)
  let pendingRequest = null;
  // 请求重试耗尽后的冷却期,避免每条新弹幕都触发一次请求(退化成旧逻辑)
  let failureUntil = 0;
  const HISTORY_CACHE_TTL = 60000;     // 缓存有效期 60 秒
  const HISTORY_MAX_RETRY = 5;          // 请求级别重试次数(原弹幕级别 5 次重试迁移至此)
  const HISTORY_RETRY_INTERVAL = 1000; // 重试间隔 1 秒
  const HISTORY_FAIL_COOLDOWN = 10000; // 失败冷却 10 秒

  // 发起一次 history 请求并构建 ctMap;非 200/解析失败/格式不符则重试,最多 HISTORY_MAX_RETRY 次。
  function fetchHistoryMap(api, attempt) {
    return new Promise(function (resolve) {
      function retryOrFail() {
        if (attempt < HISTORY_MAX_RETRY) {
          setTimeout(function () { fetchHistoryMap(api, attempt + 1).then(resolve); }, HISTORY_RETRY_INTERVAL);
        } else {
          resolve(null);
        }
      }
      let xhr;
      try { xhr = new win.XMLHttpRequest(); } catch (e) { return retryOrFail(); }
      xhr.open('GET', api);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        let ctMap = null;
        if (xhr.status === 200) {
          try {
            const json = JSON.parse(xhr.responseText);
            const list = json && json.data && json.data.room;
            if (json && json.code === 0 && Array.isArray(list)) {
              ctMap = new win.Map();
              // 顺序遍历,遇到重复 ct 时后写覆盖,等价于原代码"逆序取最近出现的一条"
              for (let i = 0; i < list.length; i++) {
                const item = list[i];
                const ct = item && item.check_info && item.check_info.ct;
                if (ct != null) ctMap.set(ct, { uid: item.uid, name: item.nickname });
              }
            }
          } catch (e) {}
        }
        if (ctMap) resolve(ctMap);
        else retryOrFail();
      };
      try { xhr.send(); } catch (e) { retryOrFail(); }
    });
  }

  // 取 ctMap:缓存命中则直接返回;否则发一次请求,进行中的请求被多条弹幕复用(批量)。
  function getHistoryMap() {
    const api = getHistoryApi();
    if (!api) return Promise.resolve(null);
    // 缓存命中:同时校验 TTL 与 API URL(房间切换会让 __blsHistoryApi 变化,旧缓存作废)
    if (historyCache && historyCache.api === api && Date.now() - historyCache.timestamp < HISTORY_CACHE_TTL) {
      return Promise.resolve(historyCache.ctMap);
    }
    // 失败冷却期内不再发请求
    if (Date.now() < failureUntil) return Promise.resolve(null);
    // 已有进行中的请求:复用,实现"多条脱敏弹幕只发一次 history 请求"
    if (pendingRequest) return pendingRequest;
    pendingRequest = fetchHistoryMap(api, 0).then(function (ctMap) {
      if (ctMap) {
        historyCache = { ctMap: ctMap, timestamp: Date.now(), api: api };
      } else {
        failureUntil = Date.now() + HISTORY_FAIL_COOLDOWN;
      }
      pendingRequest = null;
      return ctMap;
    });
    return pendingRequest;
  }

  // 修复单条脱敏弹幕:从缓存/批量请求的 ctMap 中按 data-ct 查找真实昵称/uid
  function reviseDanmakuName(el) {
    getHistoryMap().then(function (ctMap) {
      if (!ctMap) return;
      const ct = el.getAttribute('data-ct');
      if (ct == null || ct.length === 0) return;
      const info = ctMap.get(ct);
      if (!info) return; // 未出现在 history 列表中:不再按弹幕级别重试,等待缓存刷新后命中
      const attrs = el.getAttributeNames();
      if (attrs[1]) el.setAttribute(attrs[1], info.name);
      if (attrs[5]) el.setAttribute(attrs[5], info.uid);
      const name = el.getElementsByClassName('user-name')[0];
      if (name) name.textContent = info.name + ' : ';
    });
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
            if (attrs[5] && el.getAttribute(attrs[5]) === '0') reviseDanmakuName(el);
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

module.exports = { rewriteAuthPacket, installWsHook, parsePacket, buildPacket, bodyToJson };