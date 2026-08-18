# B站直播隐身观看 油猴脚本 设计文档

- 日期:2026-08-19
- 形态:Tampermonkey 用户脚本(`.user.js`)
- 目标:在 bilibili.com 直播页隐身观看——主播看不到我进房、我不出现在在线人数/在线列表,同时保留粉丝勋章亲密度

## 1. 背景与机制(调研结论)

B站直播"被主播看到"走两条独立通道,都必须处理:

### 1.1 HTTP 通道
> 以下接口经 B 站直播核心 bundle `blfe-live-room/app.js` 源码确认(2026-08-19 抓取)。旧文档中的 `live-trace.bilibili.com/.../webHeartBeat` 和 `x25Kn` 已废弃,当前前端不再调用。

| 接口 | 作用 | 本脚本处理 |
|---|---|---|
| `POST api.live.bilibili.com/xlive/web-room/v1/index/roomEntryAction` | 进房上报 | **拦截** |
| `POST api.live.bilibili.com/xlive/web-room/v1/index/TrigerInteract` | 触发进房互动广播(XXX进入直播间),带 cookie | **拦截** |
| `POST data.bilivideo.com/log/web/te9Kl` | 进房首包+签名校验(reportEnterRoom/reportCheckSign) | **拦截**(域名+前缀宽匹配) |
| `POST data.bilivideo.com/log/web/s82Tq` | 周期在线心跳(reportHeartBeat),决定在线状态 | **拦截**(域名+前缀宽匹配) |
| `POST api.live.bilibili.com/xlive/web-room/v1/index/roomReportAction` | 播放质量上报,与隐身无关 | **放行** |

### 1.2 WebSocket 通道
弹幕连接 `wss://{host}/sub`,二进制包 = 16字节定长头 + body。关键操作码:

| op | 方向 | 含义 | 本脚本处理 |
|---|---|---|---|
| 7 | 客户端→服务器 | 进房/认证包(JSON: `{uid,roomid,protover:3,buvid,support_ack,queue_uuid,scene,platform:"web",type:2,key}`) | **改写 uid→0 后发送**(不拦,否则5秒断连没弹幕) |
| 2 | 客户端→服务器 | 心跳包 | **照发**(维持连接,不影响隐身) |
| 5 | 服务器→客户端 | 业务消息 | 透传 |
| 8 | 服务器→客户端 | 认证回复 | 透传 |

### 1.3 权衡与风险
- **亲密度**:当前 B 站网页版已无 `x25Kn` 接口,亲密度上报走 `data.bilivideo.com/log/web/`,已被本脚本拦截。隐身与亲密度上报同源,二者不可兼得——隐身后亲密度不涨是预期行为。
- **进房广播的真正触发**:实测发现 op=7 的 uid 改 0 后主播仍看得到进房,根因是 `TrigerInteract` 接口主动触发广播(带 cookie,服务端据此识别登录用户),拦截此接口后才彻底隐身。
- **封号风险**:低。拦截是"不主动上报",非刷量。
- **风控风险**:接口可能返回 -352(针对IP,自动解除),非封号。
- **cookie**:不需要用户手动提供。脚本注入页面运行,自动读取页面登录态。

## 2. 架构

```
bilibili-live-stealth.user.js
├── GM 元数据 (@grant unsafeWindow, GM_set/getValue, @run-at document-start, @match)
├── Config 模块      —— { stealth: true } GM_setValue 持久化,UI 读写
├── HTTP Hook 模块   —— 包裹 unsafeWindow.XMLHttpRequest + fetch
├── WebSocket Hook 模块 —— Proxy(unsafeWindow.WebSocket, {construct})
└── UI 模块          —— 右下角浮动开关 + 拦截计数
```

**关键技术决策**:
- **不引入外部 ajax-hook 库**,手写 XHR/fetch 包裹,依赖少、好维护、无 CDN 风险。
- **`@run-at document-start`**:在页面建立 WS / 发心跳之前 hook 就位,这是成败关键。
- **操作 `unsafeWindow`**(非脚本沙箱 window),hook 的才是页面真正用的 XHR/WS。

## 3. HTTP Hook 模块

包裹 `unsafeWindow.XMLHttpRequest` 与 `unsafeWindow.fetch`:

- 拦截 URL 匹配(用 `includes` 宽匹配,抗参数变更):
  - `xlive/web-room/v1/index/roomEntryAction`
  - `xlive/rdata-interface/v1/heartbeat/webHeartBeat`
- 拦截动作:**不真发请求**,伪造成功响应 `{code:0,message:"OK"}`,调用 XHR 的 `onload`/`onreadystatechange` 或 fetch 返回 `new Response(fakeJson)`,让页面以为上报成功(避免报错/重试)。
- 放行:所有其他请求原样透传。
- 仅在 `config.stealth === true` 时拦截;关闭时全部原样放行。
- 每次成功拦截 +1 计数,更新 UI。

## 4. WebSocket Hook 模块

`Proxy(unsafeWindow.WebSocket, { construct(target, args) })`:
- 在 `new WebSocket(url)` 时拦截,拿到 ws 实例,包裹其 `send` 与 `onmessage`。
- **`send` 包裹**:解析 16字节头取 op;若 `op===7`,解 JSON body,把 `uid` 改 `0`,重新拼包发出;其他 op 原样透传。
  - 解析失败(非预期格式)→ 原样透传,绝不阻断。
- **`onmessage` 包裹**(可选,纯本地):过滤 `cmd` 为 `INTERACT_WORD`/`INTERACT_WORD_V2`/`ENTRY_EFFECT` 且 uid 等于自身 uid 的消息(双重保险,即便服务端偶尔广播了,本地也不显示)。
- `op=2` 心跳照发。
- 仅在开关开启时改写 uid;关闭时 send 原样透传。

## 5. UI 模块

右下角浮动小面板:
```
┌────────────────────┐
│ 🫥 隐身 [开]        │
│ 拦截: 12 次         │
└────────────────────┘
```
- 开关:点 `[开]`/`[关]` 切换,立即生效,状态存 `GM_setValue`。
- 拦截计数:HTTP + WS 总数,直观显示脚本在生效。
- 样式:`!important` 内联,z-index 拉高,固定右下角。开关关闭时面板仍显示 `[关]`,拦截归零。

## 6. 边界与错误处理

- `@run-at document-start` 确保 hook 早于页面建 WS / 发心跳。
- 用 `unsafeWindow` 而非沙箱 window。
- URL 宽匹配(`includes`),抗 B站加参数/换前缀。
- WS 包解析失败 → 原样透传,不阻断弹幕。
- 伪造响应失败 → 降级"真发送但忽略结果"(宁可隐身失败也不破坏看直播)。
- 所有 hook 包 try/catch,异常 fallback 到原始行为。
- B站改接口:URL 关键词匹配写宽(`live-trace.bilibili.com` + `heartbeat`),抗小幅变更;若失效,改匹配规则即可,架构不变。

## 7. 扩展点(未来)

- 完整隐身模式开关:把 `x25Kn/E`、`x25Kn/X` 加入拦截列表(代码留好位置,改一个数组即可)。
- 拖动 UI 面板位置(可选)。
- 多语言(非必需,默认中文)。

## 8. 参考来源

- bilibili-API-collect 直播心跳上报:`github.com/pskdje/bilibili-API-collect/blob/main/docs/live/report.md`
- bilibili-API-collect WS 协议:`docs/live/message_stream.md`
- andywang425/BLTH 隐身入场:`github.com/andywang425/BLTH`
- xfgryujk/bliveproxy WS hook 框架:`github.com/xfgryujk/bliveproxy`
- lzghzr/BiLiveInvisible(Xposed 隐身模块)