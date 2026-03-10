# OpenClaw 蓝信渠道

蓝信开放平台智能机器人渠道插件，支持私聊与群聊。

## 日志与调试

### 日志目录

OpenClaw 默认日志目录：

- **Linux/macOS**：`/tmp/openclaw/openclaw-YYYY-MM-DD.log`
- 可在 `~/.openclaw/openclaw.json` 中配置 `logging.file` 覆盖路径

查看实时日志：

```bash
openclaw logs --follow
```

按渠道过滤：

```bash
openclaw channels logs --channel lanxin
```

### 调试信息

蓝信渠道在收到 webhook 时会输出以下调试日志（带 `[lanxin]` 前缀）：

- `webhook POST /path`：收到请求
- `body parse failed`：请求体解析失败
- `no encrypt/dataEncrypt`：无加密数据
- `no matching target`：签名校验失败或配置缺失
- `received N event(s)`：解析到的事件数量
- `inbound eventType=... from=... to=...`：单条消息详情
- `skip ...`：跳过原因（空内容、策略、配对等）
- `dispatching to agent sessionKey=...`：开始派发给 AI

若机器人发消息后未收到回复，可据此排查：

1. 是否出现 `webhook POST`？若无，检查 webhookUrl 与反向代理配置
2. 是否 `no matching target`？检查 callbackKey、callbackSignToken 与蓝信后台一致
3. 是否 `skip`？检查 dmPolicy、groupPolicy、allowFrom、配对状态
4. 是否 `send failed: API 请求路径错误`？说明发送消息的 API 路径与当前网关不匹配。可在 `channels.lanxin` 中配置：
   - `sendPrivateMsgPath`：发送私聊的 API 路径（默认 `/v1/bot/sendPrivateMsg`）
   - `sendGroupMsgPath`：发送群聊的 API 路径（默认 `/v1/bot/sendGroupMsg`）
   - 请查阅蓝信开放平台文档确认你所用网关的正确接口路径，并覆盖上述配置
