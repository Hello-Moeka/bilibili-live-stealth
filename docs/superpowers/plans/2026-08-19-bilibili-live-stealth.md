# B站直播隐身观看油猴脚本 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个 Tampermonkey 用户脚本,在 bilibili.com 直播页拦截进房上报与在线心跳 HTTP 请求、改写 WebSocket 进房认证包的 uid 为 0,达到主播看不到进房、不在在线列表的隐身效果,同时保留粉丝勋章亲密度。

**Architecture:** 单文件用户脚本 `bilibili-live-stealth.user.js`,内部按职责拆四个模块(Config / HttpHook / WsHook / UI)。核心拦截逻辑拆成无 DOM 依赖的纯函数放在 `src/` 下并单独测试,再由 `build` 步骤内联进最终用户脚本。HTTP 用手写 XHR/fetch 包裹,WS 用 Proxy 包裹 `window.WebSocket` 的 construct trap。

**Tech Stack:** 原生 JavaScript(ES2020),Tampermonkey `@grant unsafeWindow/GM_setValue/GM_getValue`,`@run-at document-start`。测试用 Node.js + `jsdom` 模拟浏览器环境,`mocha` + 内置 `assert`。

## Global Constraints

- 用户脚本必须在 `@run-at document-start` 注入,早于页面建 WS / 发心跳。
- 所有页面对象操作必须经 `unsafeWindow`,不是脚本沙箱的 `window`。
- URL 匹配用 `includes` 宽匹配,抗 B站加参数/换前缀。
- WS 包解析失败必须原样透传,绝不阻断弹幕连接。
- 所有 hook 包 try/catch,异常 fallback 到原始行为(宁可隐身失败也不破坏看直播)。
- 不引入外部 ajax-hook 库;XHR/fetch/WS hook 全部手写。
- 拦截列表(可改一处即切完整隐身):`BLOCKED_URLS` 数组,当前含 `roomEntryAction`、`webHeartBeat`;`x25Kn/E`、`x25Kn/X` 不在列表内。
- 隐身开关默认 `true`,状态持久化到 `GM_setValue('bls_stealth', true/false)`。
- 项目语言/注释:中文,与设计文档一致。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/config.js` | 读写开关状态(`getStealth()`/`setStealth()`),持久化抽象,纯逻辑可测 |
| `src/http-hook.js` | HTTP 拦截器:XHR/fetch 包裹工厂 + URL 匹配 + 伪造响应;导出 `installHttpHook(win, cfg, onIntercept)` 与纯函数 `shouldBlock(url)`、`fakeResponseText()` |
| `src/ws-hook.js` | WS 拦截器:Proxy 包裹工厂 + op=7 包解析/改写;导出 `installWsHook(win, cfg, onIntercept)` 与纯函数 `parsePacket(buf)`、`rewriteAuthUid(packet, newUid)` |
| `src/ui.js` | 右下角浮动面板注入;导出 `installUi(win, cfg, onIntercept)` |
| `src/packet.js` | WS 包二进制编解码纯函数(共享,ws-hook 依赖) |
| `bilibili-live-stealth.user.js` | 最终用户脚本:内联上述模块 + GM 元数据 + 入口装配 |
| `build.js` | Node 脚本:把 `src/*.js` 内联进用户脚本模板生成 `.user.js` |
| `test/config.test.js` | config 测试 |
| `test/http-hook.test.js` | http-hook 纯函数 + 集成测试(jsdom 模拟 XHR/fetch) |
| `test/ws-hook.test.js` | ws-hook 纯函数 + 集成测试(jsdom 模拟 WebSocket) |
| `test/packet.test.js` | packet 编解码测试 |
| `package.json` | 依赖与脚本 |

---

### Task 1: 项目脚手架与测试环境

**Files:**
- Create: `package.json`
- Create: `test/.mocharc.json`
- Create: `src/.gitkeep` (占位,保证目录入 git)

**Interfaces:**
- Produces: 可运行的 `npm test` 命令(mocha + jsdom);后续任务依赖此环境。

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "bilibili-live-stealth",
  "version": "1.0.0",
  "private": true,
  "description": "B站直播隐身观看油猴脚本",
  "scripts": {
    "test": "mocha",
    "build": "node build.js"
  },
  "devDependencies": {
    "jsdom": "^24.0.0",
    "mocha": "^10.0.0"
  }
}
```

- [ ] **Step 2: 写 mocha 配置**

`test/.mocharc.json`:
```json
{
  "spec": "test/**/*.test.js",
  "timeout": 5000
}
```

- [ ] **Step 3: 装依赖并跑空测试套件**

Run: `npm install`
Run: `npm test`
Expected: `0 passing` 无报错(套件为空但 mocha 正常启动)。

- [ ] **Step 4: 提交**

```bash
git add package.json package-lock.json test/.mocharc.json src/.gitkeep
git commit -m "chore: 项目脚手架与测试环境"
```

---

### Task 2: Config 模块(开关持久化)

**Files:**
- Create: `src/config.js`
- Create: `test/config.test.js`

**Interfaces:**
- Consumes: 一个符合 `{ getValue(k, d), setValue(k, v) }` 的存储后端(测试用假对象,脚本里用 GM_*)- Produces: `createConfig(storage)` → `{ getStealth(): boolean, setStealth(b): void, onChange(cb): void }`

- [ ] **Step 1: 写失败测试**

`test/config.test.js`:
```javascript
const assert = require('assert');
const { createConfig } = require('../src/config.js');

function fakeStorage() {
  const m = new Map();
  return { getValue: (k, d) => m.has(k) ? m.get(k) : d, setValue: (k, v) => m.set(k, v) };
}

describe('config', () => {
  it('默认隐身开启', () => {
    const cfg = createConfig(fakeStorage());
    assert.strictEqual(cfg.getStealth(), true);
  });
  it('关闭后持久化', () => {
    const store = fakeStorage();
    const cfg = createConfig(store);
    cfg.setStealth(false);
    assert.strictEqual(store.getValue('bls_stealth', true), false);
    assert.strictEqual(cfg.getStealth(), false);
  });
  it('切换触发 onChange 回调,传入新值', () => {
    const cfg = createConfig(fakeStorage());
    let seen = null;
    cfg.onChange(v => { seen = v; });
    cfg.setStealth(false);
    assert.strictEqual(seen, false);
    cfg.setStealth(true);
    assert.strictEqual(seen, true);
  });
  it('读已保存的 false', () => {
    const store = fakeStorage();
    store.setValue('bls_stealth', false);
    const cfg = createConfig(store);
    assert.strictEqual(cfg.getStealth(), false);
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test`
Expected: FAIL `Cannot find module '../src/config.js'`

- [ ] **Step 3: 写实现**

`src/config.js`:
```javascript
'use strict';

const KEY = 'bls_stealth';
const DEFAULT = true;

// storage: { getValue(key, default), setValue(key, value) }
function createConfig(storage) {
  let stealth = storage.getValue(KEY, DEFAULT);
  const listeners = [];

  return {
    getStealth() { return stealth; },
    setStealth(v) {
      const b = !!v;
      if (b === stealth) return;
      stealth = b;
      storage.setValue(KEY, b);
      for (const cb of listeners) {
        try { cb(b); } catch (e) { /* 回调失败不影响状态 */ }
      }
    },
    onChange(cb) { listeners.push(cb); }
  };
}

module.exports = { createConfig };
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npm test`
Expected: 4 passing

- [ ] **Step 5: 提交**

```bash
git add src/config.js test/config.test.js
git commit -m "feat(config): 开关持久化模块"
```

---

### Task 3: WS 包编解码(packet 模块)

**Files:**
- Create: `src/packet.js`
- Create: `test/packet.test.js`

**Interfaces:**
- Produces:
  - `parsePacket(buf: ArrayBuffer|Uint8Array): { packetLength, headerLength, protoVer, op, seq, body: Uint8Array } | null` —— 头不全或长度不足返回 null
  - `buildPacket(op, body: Uint8Array|string, protoVer=1, seq=1): Uint8Array`
  - `bodyToJson(body: Uint8Array): object|null` —— 非 UTF-8 JSON 返回 null

- [ ] **Step 1: 写失败测试**

`test/packet.test.js`:
```javascript
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
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test`
Expected: FAIL `Cannot find module '../src/packet.js'`

- [ ] **Step 3: 写实现**

`src/packet.js`:
```javascript
'use strict';

const HEADER_LEN = 16;

// 解析一个 WS 包头;返回字段对象,或 null(数据不足/头不全)
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

// 拼一个 WS 包;body 可为 Uint8Array 或 string(按 UTF-8 编码)
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

// 把 body 当 UTF-8 JSON 解析;失败返回 null
function bodyToJson(body) {
  try {
    const text = new TextDecoder('utf-8').decode(body);
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

module.exports = { parsePacket, buildPacket, bodyToJson };
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npm test`
Expected: packet 5 passing + config 4 passing = 9 passing

- [ ] **Step 5: 提交**

```bash
git add src/packet.js test/packet.test.js
git commit -m "feat(packet): WS 包二进制编解码"
```

---

### Task 4: WS Hook 模块

**Files:**
- Create: `src/ws-hook.js`
- Create: `test/ws-hook.test.js`

**Interfaces:**
- Consumes: `src/packet.js` 的 `parsePacket`/`buildPacket`/`bodyToJson`;`src/config.js` 的 `getStealth()`
- Produces:
  - 纯函数 `rewriteAuthPacket(buf: Uint8Array, newUid): Uint8Array|null` —— 非 op=7 或解析失败返回 null(表示不改写,调用方原样透传);成功返回新包
  - `installWsHook(win, cfg, onIntercept)` —— 包裹 `win.WebSocket`,改写 op=7 的 uid 为 0,op=2 透传;每次成功改写调 `onIntercept()`

- [ ] **Step 1: 写失败测试**

`test/ws-hook.test.js`:
```javascript
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { rewriteAuthPacket, installWsHook } = require('../src/ws-hook.js');
const { buildPacket } = require('../src/packet.js');
const enc = new TextEncoder();

describe('rewriteAuthPacket', () => {
  it('改写 op=7 认证包的 uid 为 0', () => {
    const body = enc.encode(JSON.stringify({ uid: 12345, roomid: 23058, protover: 3, platform: 'web', type: 2, key: 'abc' }));
    const pkt = buildPacket(7, body, 1, 1);
    const rewritten = rewriteAuthPacket(pkt, 0);
    assert.ok(rewritten);
    const { parsePacket, bodyToJson } = require('../src/packet.js');
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
  function setup(stealth) {
    const dom = new JSDOM('', { url: 'https://live.bilibili.com/1' });
    const win = dom.window;
    // 记录真实 WebSocket 的 send,用桩替换验证调用
    const sent = [];
    const RealWS = win.WebSocket;
    const cfg = { getStealth: () => stealth };
    let interceptCount = 0;
    installWsHook(win, cfg, () => { interceptCount++; });
    return { win, sent, RealWS, getCount: () => interceptCount };
  }

  it('隐身开启时 send 的 op=7 包被改写 uid=0', () => {
    const { win, RealWS } = setup(true);
    // 用桩 WebSocket:构造时不连真实服务,只记录 send
    let captured;
    const StubWS = function (url) {
      captured = this;
      this.url = url;
      this.send = function (data) { /* 桩:什么都不做,改写已在上层发生 */ };
      this.readyState = 1;
    };
    win.WebSocket = StubWS; // 桩替换被 hook 后的 WebSocket
    // 注意:installWsHook 包裹的是 win.WebSocket,我们把它再赋桩等于绕过 hook;
    // 正确测法:调用被 hook 的 win.WebSocket(即 Proxy)
    // 重做:在 install 之前替换为桩,再 install
  });

  it('隐身开启时 op=2 心跳原样透传不改写', () => {
    // 见上面修正后的通用测法
  });
});
```

> 注:上面集成测试的桩写法有歧义。下面给出修正后的干净测法——用一个最小 WebSocket 桩类,在被 hook 之前注入 `win.WebSocket`,然后 install,验证 hook 后 send 到的内容。

替换 `describe('installWsHook', ...)` 整块为:

```javascript
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
    const { parsePacket, bodyToJson } = require('../src/packet.js');
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
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test`
Expected: FAIL `Cannot find module '../src/ws-hook.js'`

- [ ] **Step 3: 写实现**

`src/ws-hook.js`:
```javascript
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
      return ws;
    }
  });

  win.WebSocket = Proxied;
}

module.exports = { rewriteAuthPacket, installWsHook };
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npm test`
Expected: ws-hook 纯函数 4 + 集成 4 + packet 5 + config 4 = 17 passing

- [ ] **Step 5: 提交**

```bash
git add src/ws-hook.js test/ws-hook.test.js
git commit -m "feat(ws-hook): WS 进房认证包改写 uid"
```

---

### Task 5: HTTP Hook 模块

**Files:**
- Create: `src/http-hook.js`
- Create: `test/http-hook.test.js`

**Interfaces:**
- Consumes: `src/config.js` 的 `getStealth()`
- Produces:
  - 常量 `BLOCKED_URLS = ['/xlive/web-room/v1/index/roomEntryAction', '/xlive/rdata-interface/v1/heartbeat/webHeartBeat']`
  - 纯函数 `shouldBlock(url: string): boolean`
  - 纯函数 `fakeResponseText(): string` —— 返回 `'{"code":0,"message":"OK","data":{}}'`
  - `installHttpHook(win, cfg, onIntercept)` —— 包裹 `win.XMLHttpRequest` 与 `win.fetch`,匹配则伪造响应不发真请求,每次拦截调 `onIntercept()`

- [ ] **Step 1: 写失败测试**

`test/http-hook.test.js`:
```javascript
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { shouldBlock, fakeResponseText, installHttpHook, BLOCKED_URLS } = require('../src/http-hook.js');

describe('shouldBlock', () => {
  it('拦 roomEntryAction', () => {
    assert.strictEqual(shouldBlock('https://api.live.bilibili.com/xlive/web-room/v1/index/roomEntryAction?room_id=1'), true);
  });
  it('拦 webHeartBeat', () => {
    assert.strictEqual(shouldBlock('https://live-trace.bilibili.com/xlive/rdata-interface/v1/heartbeat/webHeartBeat?hb=xx'), true);
  });
  it('放行 x25Kn(保留亲密度)', () => {
    assert.strictEqual(shouldBlock('https://live-trace.bilibili.com/xlive/data-interface/v1/x25Kn/X'), false);
  });
  it('放行无关请求', () => {
    assert.strictEqual(shouldBlock('https://api.bilibili.com/x/web-interface/view'), false);
  });
  it('BLOCKED_URLS 含 roomEntryAction 与 webHeartBeat,不含 x25Kn', () => {
    assert.ok(BLOCKED_URLS.some(u => u.includes('roomEntryAction')));
    assert.ok(BLOCKED_URLS.some(u => u.includes('webHeartBeat')));
    assert.ok(!BLOCKED_URLS.some(u => u.includes('x25Kn')));
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

  it('隐身开启:拦 roomEntryAction,不真发,返回伪造响应', (done) => {
    const win = makeWin();
    // 桩 XHR:记录是否真发网络
    let realOpened = false;
    win.XMLHttpRequest = function () {
      this.readyState = 0;
      this.open = function (m, u) { this._url = u; };
      this.send = function () { realOpened = true; /* 不真发 */ };
      this.setRequestHeader = function () {};
    };
    const cfg = { getStealth: () => true };
    let count = 0;
    installHttpHook(win, cfg, () => { count++; });
    const xhr = new win.XMLHttpRequest();
    xhr.onload = function () {
      try {
        assert.strictEqual(realOpened, false); // 没真发
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
    let realSent = false;
    win.XMLHttpRequest = function () {
      this.open = function (m, u) { this._url = u; };
      this.send = function () { realSent = true; };
      this.setRequestHeader = function () {};
    };
    const cfg = { getStealth: () => false };
    let count = 0;
    installHttpHook(win, cfg, () => { count++; });
    const xhr = new win.XMLHttpRequest();
    xhr.open('POST', 'https://api.live.bilibili.com/xlive/web-room/v1/index/roomEntryAction');
    xhr.send();
    assert.strictEqual(realSent, true);
    assert.strictEqual(count, 0);
  });
});

describe('installHttpHook (fetch)', () => {
  function makeWin() {
    const dom = new JSDOM('', { url: 'https://live.bilibili.com/1' });
    return dom.window;
  }
  it('隐身开启:拦 webHeartBeat,返回伪造 Response', async () => {
    const win = makeWin();
    let realCalled = false;
    win.fetch = async () => { realCalled = true; return new win.Response('{}'); };
    const cfg = { getStealth: () => true };
    let count = 0;
    installHttpHook(win, cfg, () => { count++; });
    const res = await win.fetch('https://live-trace.bilibili.com/xlive/rdata-interface/v1/heartbeat/webHeartBeat?hb=x');
    assert.strictEqual(realCalled, false);
    assert.strictEqual(count, 1);
    const text = await res.text();
    assert.strictEqual(JSON.parse(text).code, 0);
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test`
Expected: FAIL `Cannot find module '../src/http-hook.js'`

- [ ] **Step 3: 写实现**

`src/http-hook.js`:
```javascript
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
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npm test`
Expected: http-hook 5 + ws-hook 8 + packet 5 + config 4 = 22 passing

- [ ] **Step 5: 提交**

```bash
git add src/http-hook.js test/http-hook.test.js
git commit -m "feat(http-hook): XHR/fetch 心跳拦截"
```

---

### Task 6: UI 模块

**Files:**
- Create: `src/ui.js`
- Create: `test/ui.test.js`

**Interfaces:**
- Consumes: `src/config.js` 的 `getStealth()`/`setStealth()`/`onChange()`
- Produces: `installUi(win, cfg, getInterceptCount)` —— 注入右下角浮动面板;`getInterceptCount` 是 `() => number`

- [ ] **Step 1: 写失败测试**

`test/ui.test.js`:
```javascript
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { installUi } = require('../src/ui.js');

function makeWin() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://live.bilibili.com/1' });
  return dom.window;
}

describe('installUi', () => {
  it('注入面板到 body,显示当前隐身状态与计数', () => {
    const win = makeWin();
    const cfg = { getStealth: () => true, setStealth: () => {}, onChange: () => {} };
    installUi(win, cfg, () => 12);
    const panel = win.document.querySelector('#bls-panel');
    assert.ok(panel, '面板应被注入');
    assert.ok(panel.textContent.includes('隐身'));
    assert.ok(panel.textContent.includes('12'));
  });

  it('点开关切换调用 cfg.setStealth,传入相反值', () => {
    const win = makeWin();
    let setCalled = null;
    const cfg = { getStealth: () => true, setStealth: (v) => { setCalled = v; }, onChange: () => {} };
    installUi(win, cfg, () => 0);
    const toggle = win.document.querySelector('#bls-toggle');
    assert.ok(toggle);
    toggle.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(setCalled, false); // 从 true 切到 false
  });

  it('cfg.onChange 触发时面板更新显示', () => {
    const win = makeWin();
    let changeCb = null;
    const cfg = { getStealth: () => true, setStealth: () => {}, onChange: (cb) => { changeCb = cb; } };
    installUi(win, cfg, () => 0);
    changeCb(false); // 模拟状态变 false
    const status = win.document.querySelector('#bls-status');
    assert.ok(status.textContent.includes('关'));
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test`
Expected: FAIL `Cannot find module '../src/ui.js'`

- [ ] **Step 3: 写实现**

`src/ui.js`:
```javascript
'use strict';

function installUi(win, cfg, getInterceptCount) {
  const doc = win.document;
  if (!doc || !doc.body) {
    // body 还没就绪,等 DOMContentLoaded
    doc.addEventListener('DOMContentLoaded', () => inject(win, cfg, getInterceptCount), { once: true });
    return;
  }
  inject(win, cfg, getInterceptCount);
}

function inject(win, cfg, getInterceptCount) {
  const doc = win.document;
  if (doc.querySelector('#bls-panel')) return; // 防重复

  const panel = doc.createElement('div');
  panel.id = 'bls-panel';
  panel.setAttribute('style', [
    'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
    'padding:8px 12px', 'background:rgba(30,30,35,0.9)', 'color:#fff',
    'border-radius:8px', 'font:12px/1.5 sans-serif', 'box-shadow:0 2px 8px rgba(0,0,0,0.4)',
    'cursor:default', 'user-select:none', 'border:1px solid rgba(255,255,255,0.15)'
  ].join(';') + ';');

  const status = doc.createElement('span');
  status.id = 'bls-status';
  status.textContent = cfg.getStealth() ? '隐身 [开]' : '隐身 [关]';
  status.style.cursor = 'pointer';
  status.style.marginRight = '8px';

  const toggle = doc.createElement('span');
  toggle.id = 'bls-toggle';
  toggle.textContent = '⚙';
  toggle.style.cursor = 'pointer';
  toggle.title = '点击切换隐身开关';

  const countLine = doc.createElement('div');
  countLine.id = 'bls-count';
  countLine.style.fontSize = '11px';
  countLine.style.opacity = '0.8';
  countLine.textContent = '拦截: ' + getInterceptCount() + ' 次';

  // 点击状态或齿轮都切换
  function onToggle() {
    cfg.setStealth(!cfg.getStealth());
  }
  status.addEventListener('click', onToggle);
  toggle.addEventListener('click', onToggle);

  // 状态变化时刷新显示
  cfg.onChange((v) => {
    status.textContent = v ? '隐身 [开]' : '隐身 [关]';
  });

  // 周期刷新计数
  setInterval(() => {
    countLine.textContent = '拦截: ' + getInterceptCount() + ' 次';
  }, 2000);

  panel.appendChild(status);
  panel.appendChild(toggle);
  panel.appendChild(countLine);
  doc.body.appendChild(panel);
}

module.exports = { installUi };
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npm test`
Expected: ui 3 + http-hook 5 + ws-hook 8 + packet 5 + config 4 = 25 passing

- [ ] **Step 5: 提交**

```bash
git add src/ui.js test/ui.test.js
git commit -m "feat(ui): 右下角浮动开关面板"
```

---

### Task 7: 构建脚本 + 最终用户脚本装配

**Files:**
- Create: `build.js`
- Create: `bilibili-live-stealth.user.js`(由 build 生成,或手写模板)
- Create: `test/build.test.js`

**Interfaces:**
- Consumes: `src/*.js` 全部模块
- Produces: `bilibili-live-stealth.user.js` 单文件用户脚本,可直接装进 Tampermonkey

- [ ] **Step 1: 写构建脚本**

`build.js`:
```javascript
'use strict';
const fs = require('fs');
const path = require('path');

function readSrc(name) {
  return fs.readFileSync(path.join(__dirname, 'src', name), 'utf8')
    .replace(/^'use strict';\s*/, '')
    .replace(/module\.exports\s*=\s*[\s\S]*$/, '');
}

function stripRequires(src) {
  // 去掉 require('./xxx') 行,内联后不再需要
  return src.replace(/const\s+\{[^}]*\}\s*=\s*require\(['"]\.\/[^'"]+['"]\);?\s*/g, '')
            .replace(/require\(['"]\.\/[^'"]+['"]\)/g, '{}');
}

const modules = ['config.js', 'packet.js', 'http-hook.js', 'ws-hook.js', 'ui.js'].map(readSrc).map(stripRequires);

const header = `// ==UserScript==
// @name         B站直播隐身观看
// @namespace    https://github.com/local/bilibili-live-stealth
// @version      1.0.0
// @description  隐身看B站直播:主播看不到你进房,你不出现在在线列表,保留粉丝勋章亲密度。带右下角开关。
// @author       anonymous
// @match        *://live.bilibili.com/*
// @match        *://live.bilibili.com/blanc/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==
`;

const entry = `
(function () {
  'use strict';
  const win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

  // 存储后端:优先 GM_*,无则降级 localStorage
  const storage = (typeof GM_setValue !== 'undefined' && typeof GM_getValue !== 'undefined')
    ? { getValue: (k, d) => GM_getValue(k, d), setValue: (k, v) => GM_setValue(k, v) }
    : { getValue: (k, d) => { try { return localStorage.getItem(k) === null ? d : JSON.parse(localStorage.getItem(k)); } catch (e) { return d; } },
        setValue: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

  let interceptCount = 0;
  const onIntercept = () => { interceptCount++; };

  const cfg = createConfig(storage);

  try { installHttpHook(win, cfg, onIntercept); } catch (e) { console.warn('[BLS] HTTP hook 失败', e); }
  try { installWsHook(win, cfg, onIntercept); } catch (e) { console.warn('[BLS] WS hook 失败', e); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      try { installUi(win, cfg, () => interceptCount); } catch (e) { console.warn('[BLS] UI 失败', e); }
    });
  } else {
    try { installUi(win, cfg, () => interceptCount); } catch (e) { console.warn('[BLS] UI 失败', e); }
  }
})();
`;

const out = header + '\n' + modules.join('\n\n') + '\n' + entry + '\n';
fs.writeFileSync(path.join(__dirname, 'bilibili-live-stealth.user.js'), out, 'utf8');
console.log('built bilibili-live-stealth.user.js (' + out.length + ' bytes)');
```

- [ ] **Step 2: 写构建测试**

`test/build.test.js`:
```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

describe('build', () => {
  it('生成 .user.js 文件,含 Tampermonkey 元数据头', () => {
    execSync('node build.js', { cwd: __dirname + '/..' });
    const file = path.join(__dirname, '..', 'bilibili-live-stealth.user.js');
    assert.ok(fs.existsSync(file), '应生成 user.js');
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(content.includes('// ==UserScript=='), '应有元数据头');
    assert.ok(content.includes('@run-at       document-start'), '应在 document-start 注入');
    assert.ok(content.includes('@match        *://live.bilibili.com/*'), '应匹配直播页');
    assert.ok(content.includes('installHttpHook'), '应内联 HTTP hook');
    assert.ok(content.includes('installWsHook'), '应内联 WS hook');
    assert.ok(content.includes('installUi'), '应内联 UI');
  });
});
```

- [ ] **Step 3: 跑构建与测试**

Run: `node build.js`
Run: `npm test`
Expected: `built bilibili-live-stealth.user.js (...bytes)`,全部测试通过(25 + build 1 = 26 passing)

- [ ] **Step 4: 提交**

```bash
git add build.js test/build.test.js bilibili-live-stealth.user.js
git commit -m "feat(build): 装配最终用户脚本"
```

---

### Task 8: README 与最终验收

**Files:**
- Create: `README.md`

- [ ] **Step 1: 写 README**

`README.md`:
```markdown
# B站直播隐身观看 油猴脚本

隐身看 B 站直播:主播看不到你进房,你不出现在在线人数/在线列表,同时**保留粉丝勋章亲密度**。右下角带开关。

## 工作原理

拦截两条通道:
- **HTTP**:`roomEntryAction`(进房上报)、`webHeartBeat`(在线心跳)被拦截并伪造成功响应,不真发。
- **WebSocket**:弹幕连接的进房认证包(`op=7`)里的 `uid` 被改写为 `0`(游客),服务端不把你当登录用户广播入场提示;`op=2` 心跳照发维持连接。
- **不拦** `x25Kn` 加密心跳 → 粉丝勋章亲密度照涨、小心心照拿。代价:理论上可能被某些高能榜统计计入。

## 安装

1. 装 Tampermonkey 浏览器扩展。
2. Tampermonkey → 新建脚本 → 粘贴 `bilibili-live-stealth.user.js` 全部内容 → 保存。
3. 打开任意 B 站直播间,右下角出现"隐身 [开]"面板即生效。

## 使用

- **默认隐身开启**。右下角点"隐身 [开]/[关]"或齿轮切换,立即生效,状态持久化(刷新后保持)。
- "拦截: N 次"显示已拦截的进房/在线心跳数,数字增长说明脚本在干活。

## 开发

\`\`\`bash
npm install      # 装依赖
npm test         # 跑全部测试
node build.js    # 重新生成 .user.js(改 src 后)
\`\`\`

源码在 `src/`,测试在 `test/`,构建脚本 `build.js` 把 `src/*.js` 内联进 `bilibili-live-stealth.user.js`。

## 权衡

- **保留亲密度**:不拦 `x25Kn`,亲密度照涨,但可能上某些高能榜。要彻底隐身(丢亲密度)就把 `src/http-hook.js` 的 `BLOCKED_URLS` 加上 `x25Kn/E`、`x25Kn/X` 重新 build。
- **封号风险低**:拦截是"不主动上报",非刷量。
- **风控**:接口可能返回 -352(针对 IP,自动解除)。

## 参考

设计文档:`docs/superpowers/specs/2026-08-19-bilibili-live-stealth-design.md`
```

- [ ] **Step 2: 跑完整测试套件确认全绿**

Run: `npm test`
Expected: 全部 passing

- [ ] **Step 3: 检查生成的用户脚本完整性**

Run: `node build.js && head -20 bilibili-live-stealth.user.js`
Expected: 元数据头正确,模块内联完整。

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: README"
```

---

## 自检结果(已对照 spec 复核)

- **Spec 覆盖**:
  - HTTP 拦 roomEntryAction + webHeartBeat、放行 x25Kn → Task 5 ✅
  - WS 改写 op=7 uid=0、op=2 透传 → Task 4 ✅
  - 开关持久化 + onChange → Task 2 ✅
  - UI 开关 + 计数 + 状态切换 → Task 6 ✅
  - document-start 注入、unsafeWindow → Task 7 entry ✅
  - 扩展点(BLOCKED_URLS 改一处切完整隐身)→ Task 5 + README ✅
- **占位符**:无 TBD/TODO。
- **类型一致性**:`createConfig`/`installHttpHook`/`installWsHook`/`installUi` 在各任务签名一致;`parsePacket`/`buildPacket`/`bodyToJson` 在 Task 3 定义后 Task 4 复用一致。