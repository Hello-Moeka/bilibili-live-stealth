# B站直播隐身观看 油猴脚本

隐身看 B 站直播:主播看不到你进房,你不出现在在线人数/在线列表,同时**保留粉丝勋章亲密度**。右下角带开关。

## 工作原理

拦截三条通道(均经 B 站直播核心 bundle `blfe-live-room/app.js` 源码确认):

- **HTTP 进房上报** `api.live.bilibili.com/xlive/web-room/v1/index/roomEntryAction` —— 拦截,伪造成功响应不真发。
- **HTTP 进房互动广播** `api.live.bilibili.com/xlive/web-room/v1/index/TrigerInteract` —— 拦截。这是触发"XXX进入直播间"广播的主动接口,带 cookie 调用,不拦则主播看得到进房。
- **HTTP 在线心跳** `data.bilivideo.com/log/web/`(`te9Kl` 进房首包+签名校验、`s82Tq` 周期心跳)—— 拦截。注意:B 站已弃用旧文档里的 `live-trace.bilibili.com/xlive/rdata-interface/v1/heartbeat/webHeartBeat` 和 `x25Kn`,改用 `data.bilivideo.com`,故用域名+路径前缀宽匹配。
- **WebSocket 进房认证** 弹幕连接的 op=7 认证包里的 `uid` 被改写为 `0`(游客);op=2 心跳照发维持连接、弹幕正常。

不拦 `roomReportAction`(播放质量上报,与隐身无关)。`x25Kn` 加密心跳已不存在于当前前端,无需处理。

## 安装

1. 装 Tampermonkey 浏览器扩展。
2. Tampermonkey → 新建脚本 → 粘贴 `bilibili-live-stealth.user.js` 全部内容 → 保存。
3. 打开任意 B 站直播间,右下角出现"隐身 [开]"面板即生效。

## 使用

- **默认隐身开启**。右下角点"隐身 [开]/[关]"或齿轮切换,立即生效,状态持久化(刷新后保持)。
- "拦截: N 次"显示已拦截的进房/在线心跳数,数字增长说明脚本在干活。

## 开发

```bash
npm install      # 装依赖
npm test         # 跑全部测试
node build.js    # 重新生成 .user.js(改 src 后)
```

源码在 `src/`,测试在 `test/`,构建脚本 `build.js` 把 `src/*.js` 内联进 `bilibili-live-stealth.user.js`。

## 权衡

- **亲密度**:当前 B 站网页版前端已无 `x25Kn` 加密心跳接口(源码确认),亲密度上报走 `data.bilivideo.com/log/web/`,已被本脚本拦截。若发现亲密度不涨是预期行为(隐身与亲密度上报同源,二者不可兼得)。
- **封号风险低**:拦截是"不主动上报",非刷量。
- **风控**:接口可能返回 -352(针对 IP,自动解除)。

## 参考

设计文档:`docs/superpowers/specs/2026-08-19-bilibili-live-stealth-design.md`