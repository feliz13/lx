# lx-relay

蓝信 (Lanxin) 回调中继服务，用于将蓝信服务器的 HTTP 回调转发到本地部署的 OpenClaw。支持多客户端连接，按 openId 路由消息。

## 架构

```
蓝信服务器 ──[HTTP POST]──▶ relay-server (公网, :8088)
                                  │
                            解密回调 → 提取 from / groupId
                                  │
                            按 openId 路由
                           ┌──────┼──────┐
                      [WS :8087] [WS]   [WS]
                           │      │      │
                     client-A  client-B  client-C
                        │         │         │
                     OpenClaw  OpenClaw  OpenClaw
                     (用户1)  (用户2)  (群组1)
```

- **relay-server**：部署在公网，接收蓝信回调，解密消息后按 openId 路由到对应 client
- **relay-client**：运行在本地，注册 openId 后接收路由到自己的消息，转发给 OpenClaw

## 构建

```bash
cd relay
make          # 构建 server (linux/amd64) + client (本地架构)
make server   # 仅构建 server
make client   # 仅构建 client
make clean    # 清理
```

产物在 `bin/` 目录。

## 配置

### relay-server 配置文件

复制 `config.example.json` 为 `config.json` 并填入蓝信应用信息：

```json
{
  "secret": "your-shared-secret",
  "httpAddr": ":8088",
  "wsAddr": ":8087",
  "accounts": {
    "mycw": {
      "appId": "your-app-id",
      "appSecret": "your-app-secret",
      "gatewayUrl": "https://apigw.lanxin.cn",
      "callbackKey": "your-callback-aes-key",
      "callbackSignToken": "your-callback-sign-token"
    }
  }
}
```

配置说明：

| 字段 | 说明 |
|------|------|
| `secret` | client 连接认证密钥 |
| `httpAddr` | 蓝信回调监听地址，默认 `:8088` |
| `wsAddr` | WebSocket 监听地址，默认 `:8087` |
| `accounts` | 蓝信应用账户，用于解密回调和发送错误回复 |

accounts 中的字段与 OpenClaw lanxin 插件配置一致：

| 字段 | 说明 |
|------|------|
| `appId` | 蓝信应用 ID |
| `appSecret` | 蓝信应用密钥 |
| `gatewayUrl` | 蓝信 API 网关地址 |
| `callbackKey` | 回调 AES 解密密钥 |
| `callbackSignToken` | 回调签名验证令牌 |

## 使用

### relay-server（部署在公网服务器）

```bash
./relay-server -config config.json
```

蓝信开发者后台的回调地址配置为 `http://your-server.com:8088/lanxin`。

### relay-client（运行在本地）

```bash
# 注册处理用户 524288-abc 和群组 524288-groupXYZ 的消息
./relay-client \
  -server ws://your-server.com:8087/ws \
  -target http://localhost:18789 \
  -secret "your-shared-secret" \
  -open-ids "524288-abc,524288-groupXYZ"
```

参数说明：

| 参数 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| `-server` | `LX_RELAY_SERVER` | `ws://localhost:8087/ws` | relay-server 的 WebSocket 地址 |
| `-target` | `LX_RELAY_TARGET` | `http://localhost:18789` | OpenClaw 本地 HTTP 地址 |
| `-secret` | `LX_RELAY_SECRET` | `lx-relay-s3cret!` | 认证密钥 |
| `-open-ids` | `LX_RELAY_OPEN_IDS` | (必填) | 逗号分隔的 openId 列表 |

`-open-ids` 支持用户 openId 和群组 openId。relay-server 收到蓝信回调后：
- 私聊消息 (`bot_private_message`)：按 `from` 字段匹配 openId
- 群聊消息 (`bot_group_message`)：按 `groupId` 字段匹配 openId

### 多客户端示例

```bash
# 客户端 A：处理用户 user-001 的私聊
./relay-client -open-ids "user-001" -target http://localhost:18789 ...

# 客户端 B：处理用户 user-002 和群组 group-001 的消息
./relay-client -open-ids "user-002,group-001" -target http://localhost:18790 ...
```

### 健康检查

```bash
curl http://your-server.com:8088/health
# {"ok":true,"clientCount":2,"registeredIds":["user-001","user-002","group-001"]}
```

## 消息路由流程

1. 蓝信 POST 加密回调到 relay-server
2. relay-server 验证签名，解密消息（仅用于路由判断，解密内容输出为日志）
3. 解析事件类型和路由 key：
   - `bot_private_message` → 用 `from` 字段
   - `bot_group_message` → 用 `groupId` 字段
4. 在已注册的 openId 中查找对应 client
5. 将**原始加密请求**完整转发给匹配的 client
6. client 转发到本地 OpenClaw，由 lanxin 插件完成最终的解密和处理
7. 若无匹配 client，relay-server 通过蓝信 API 直接回复"无可用服务"

## 注意事项

- 蓝信回调有 3 秒超时，relay-server 在 2.5s 内未收到 client 响应时返回默认成功
- relay-client 断线后自动重连（指数退避，最长 30s）
- 同一个 openId 如果被多个 client 注册，后连接的 client 会替换之前的
- relay-server 转发给 client 的始终是**加密的原始请求**，解密仅用于路由决策
