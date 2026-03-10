# lx-relay

蓝信 (Lanxin) 回调中继服务，用于将蓝信服务器的 HTTP 回调转发到本地部署的 OpenClaw。

## 架构

```
蓝信服务器 ──[HTTP POST]──▶ relay-server (公网, :8088)
                                  │
                            [WebSocket :8087]
                                  │
                           relay-client (本地)
                                  │
                           [HTTP POST localhost]
                                  │
                           OpenClaw lanxin plugin
```

- **relay-server**：部署在有公网 IP 的服务器上，接收蓝信的回调请求，通过 WebSocket 转发给 relay-client
- **relay-client**：运行在本地（与 OpenClaw 同机），接收 relay-server 转发的请求，POST 到 OpenClaw 的 webhook 端点

消息发送方向（OpenClaw → 蓝信）不经过中继，直接调用蓝信 API。

## 构建

```bash
cd relay

# 构建 server
go build -o relay-server ./cmd/relay-server

# 构建 client
go build -o relay-client ./cmd/relay-client
```

## 使用

### relay-server（部署在公网服务器）

```bash
./relay-server \
  -http-addr :8088 \
  -ws-addr :8087 \
  -secret "your-shared-secret"
```

蓝信开发者后台的回调地址配置为 `https://your-server.com:8088/lanxin`（路径与 OpenClaw 的 webhookPath 保持一致）。

### relay-client（运行在本地）

```bash
./relay-client \
  -server ws://your-server.com:8087/ws \
  -target http://localhost:18789 \
  -secret "your-shared-secret"
```

`-target` 为 OpenClaw 本地 HTTP 服务地址（不含路径，路径会从原始请求中透传）。

### 环境变量

所有参数均可通过环境变量配置（优先级低于命令行参数）：

| 环境变量 | 对应参数 | 默认值 |
|---------|---------|--------|
| `LX_HTTP_ADDR` | `-http-addr` | `:8088` |
| `LX_WS_ADDR` | `-ws-addr` | `:8087` |
| `LX_RELAY_SECRET` | `-secret` | `lx-relay-s3cret!` |
| `LX_RELAY_SERVER` | `-server` | `ws://localhost:8087/ws` |
| `LX_RELAY_TARGET` | `-target` | `http://localhost:18789` |

### 健康检查

```bash
curl http://your-server.com:8088/health
# {"ok":true,"clientConnected":true}
```

## 协议

relay-server 与 relay-client 之间通过 WebSocket 交换 JSON 消息：

1. **认证**：client 连接后发送 `auth` 消息，server 返回 `auth_ok` / `auth_fail`
2. **心跳**：server 每 30s 发送 `ping`，client 回复 `pong`；90s 无消息则断开
3. **请求转发**：server 将 HTTP 回调封装为 `http_request` 发送给 client
4. **响应回传**：client 处理后将结果以 `http_response` 发回 server
5. **超时**：server 等待 client 响应最多 2.5s，超时返回默认成功响应给蓝信

## 注意事项

- 蓝信回调有 3 秒超时限制，超时后会重试（最多 3 次）。relay-server 在 2.5s 内未收到响应时会先返回成功，避免重试
- relay-client 断线后会自动重连（指数退避，最长 30s）
- 当前仅支持单个 relay-client 连接
