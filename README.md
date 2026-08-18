# B站直播隐身观看

隐身看 B 站直播:主播看不到你进房,你不出现在在线列表,弹幕正常显示。装上即生效,无需配置。

## 工作原理

采用三段式隐身方案(参考 [哔哩直播隐身](https://greasyfork.org/zh-CN/scripts/581010) v1.2.2 的实现思路):

1. **`getInfoByUser` 换假房间号** — 把请求里的真实 `room_id` 替换成假号 `27227`,服务端以为你进的是假房间,不广播"XXX 进入直播间",但仍返回有效响应(页面不报错)。
2. **`getDanmuInfo` 不带 cookie** — 弹幕 token 请求 `credentials: 'omit'`,拿游客 token,降低身份暴露。
3. **WebSocket op=7 认证包 `uid` 改 0 + 弹幕脱敏修复** — uid 改 0 后服务端不把你当登录用户广播;但弹幕用户名会脱敏(变 `*`),脚本用 MutationObserver 监听弹幕容器,通过 history API 查回真实用户名补上。
4. **在线心跳阻断** — `data.bilivideo.com/log/web/`(`te9Kl` 进房首包、`s82Tq` 周期心跳)被拦截并伪造成功响应,你不在在线人数/在线列表里。

> 以上接口均经 B 站直播核心 bundle `blfe-live-room/app.js` 源码确认(2026-08-19)。旧文档里的 `live-trace.bilibili.com/.../webHeartBeat` 和 `x25Kn` 已废弃,当前前端不再调用。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展。
2. Tampermonkey → 新建脚本 → 粘贴 [`bilibili-live-stealth.user.js`](./bilibili-live-stealth.user.js) 全部内容 → 保存。
3. 打开任意 B 站直播间,隐身自动生效。

## 隐身效果

- ✅ 主播 / 房管看不到你进房(无"XXX 进入直播间"广播)
- ✅ 不出现在在线人数 / 在线列表
- ✅ 弹幕正常显示(真实用户名,非脱敏 `*`)
- ⚠️ 亲密度不涨(隐身与亲密度上报同源,二者不可兼得)

## 权衡

- **亲密度**:当前 B 站网页版亲密度上报走 `data.bilivideo.com/log/web/`,已被拦截。隐身后亲密度不涨是预期行为。
- **封号风险低**:拦截是"不主动上报" + "改参数",非刷量。
- **风控**:接口可能返回 -352(针对 IP,自动解除)。

## 开发

```bash
npm install      # 装依赖
npm test         # 跑全部测试(21 个)
node build.js    # 重新生成 .user.js(改 src 后)
```

源码在 `src/`(`http-hook.js` / `ws-hook.js`),测试在 `test/`,构建脚本 `build.js` 把 `src/*.js` 内联进 `bilibili-live-stealth.user.js`。

## License

MIT

## 致谢

- 隐身方案参考 [哔哩直播隐身](https://greasyfork.org/zh-CN/scripts/581010) by moranjianghe
- BLTH [andywang425/BLTH](https://github.com/andywang425/BLTH) 的隐身入场模块提供了 `getInfoByUser` 参数的线索
- [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect) 的直播 API 文档