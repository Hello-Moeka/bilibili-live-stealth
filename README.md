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

```bash
npm install      # 装依赖
npm test         # 跑全部测试
node build.js    # 重新生成 .user.js(改 src 后)
```

源码在 `src/`,测试在 `test/`,构建脚本 `build.js` 把 `src/*.js` 内联进 `bilibili-live-stealth.user.js`。

## 权衡

- **保留亲密度**:不拦 `x25Kn`,亲密度照涨,但可能上某些高能榜。要彻底隐身(丢亲密度)就把 `src/http-hook.js` 的 `BLOCKED_URLS` 加上 `x25Kn/E`、`x25Kn/X` 重新 build。
- **封号风险低**:拦截是"不主动上报",非刷量。
- **风控**:接口可能返回 -352(针对 IP,自动解除)。

## 参考

设计文档:`docs/superpowers/specs/2026-08-19-bilibili-live-stealth-design.md`