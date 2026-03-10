# lx-relay 设计与实现文档

## 1. 背景与问题

OpenClaw 部署在本地开发机上，没有公网 IP。蓝信（Lanxin）的消息推送机制是 HTTP POST 回调——蓝信服务器主动向应用配置的回调地址发 POST 请求。因此需要一个中继组件来桥接"公网回调"与"本地服务"。

### 1.1 蓝信回调机制要点

- 蓝信通过 HTTP POST 将事件推送到应用注册的回调地址
- 回调数据使用 AES 对称加密 + SHA1 签名验证（详见 `lx-callback-3.md`、`lx-callback-4.md`）
- **3 秒超时**：应用需在 3 秒内返回 HTTP 200，否则蓝信会在 5min/1h/6h 后重试，最多 3 次
- 回调事件包含 `id` 字段，应用侧需做去重处理

### 1.2 OpenClaw lanxin 插件现有架构

现有插件的消息接收流程：

```
蓝信服务器 ──[HTTP POST]──▶ OpenClaw HTTP Server (webhook endpoint)
                                      │
                              handleLanxinWebhookRequest (monitor.ts)
                                      │
                              verifySignature + AES decrypt (crypto.ts)
                                      │
                              processLanxinEvent → dispatch to AI agent
```

消息发送流程（不受本问题影响）：

```
OpenClaw lanxin plugin ──[HTTP]──▶ 蓝信 API 网关 (gatewayUrl)
```

## 2. 架构选型

### 2.1 方案对比

| 维度 | 方案 1: 插件直连远端 | 方案 2: 本地服务桥接 (已选) |
|------|---------------------|---------------------------|
| 拓扑 | `openclaw ↔ 远端服务 ↔ 蓝信` | `openclaw ↔ 本地服务 ↔ 远端服务 ↔ 蓝信` |
| 插件改动 | 大：需将 HTTP webhook 重写为 WebSocket 接收 | **无**：插件仍接收本地 HTTP POST |
| 加解密处理 | 需在远端或插件中重新适配 | **原封不动**：加密数据透传，插件自行解密 |
| 关注点分离 | 传输与业务耦合 | 传输（中继）与业务（插件）完全解耦 |
| 可复用性 | 仅适用于蓝信 | 可用于任何 webhook 回调场景 |
| 调试难度 | 较高 | 低：每个组件可独立排查 |

**结论**：选择方案 2，以最小的改动代价解决问题。

### 2.2 最终架构

```
                          ┌──────────────────────────────┐
                          │       公网服务器               │
                          │                              │
蓝信服务器 ─[HTTP POST]─▶ │  relay-server                │
                          │  ├─ :8088 HTTP (接收回调)     │
                          │  └─ :8087 WebSocket (客户端)  │
                          └──────────┬───────────────────┘
                                     │ WebSocket 长连接
                          ┌──────────┴───────────────────┐
                          │       本地开发机               │
                          │                              │
                          │  relay-client                 │
                          │       │                      │
                          │       │ HTTP POST localhost   │
                          │       ▼                      │
                          │  OpenClaw (:18789)            │
                          │  └─ lanxin plugin (不改动)    │
                          └──────────────────────────────┘
```

## 3. 组件设计

### 3.1 共享协议 (`relay/protocol/message.go`)

server 与 client 之间通过 WebSocket 交换 JSON 消息，统一使用 `Message` 结构体：

```go
type Message struct {
    Type    string            `json:"type"`
    ID      string            `json:"id,omitempty"`      // 请求/响应关联 ID
    Method  string            `json:"method,omitempty"`   // HTTP method
    Path    string            `json:"path,omitempty"`     // HTTP path
    Query   string            `json:"query,omitempty"`    // URL query string
    Headers map[string]string `json:"headers,omitempty"`  // HTTP headers
    Body    string            `json:"body,omitempty"`     // HTTP body / response body
    Status  int               `json:"status,omitempty"`   // HTTP status code
    Secret  string            `json:"secret,omitempty"`   // 认证密钥
    Error   string            `json:"error,omitempty"`    // 错误信息
}
```

消息类型：

| type | 方向 | 用途 |
|------|------|------|
| `auth` | client → server | 连接后发送密钥认证 |
| `auth_ok` | server → client | 认证成功 |
| `auth_fail` | server → client | 认证失败，连接将被关闭 |
| `http_request` | server → client | 转发蓝信的 HTTP 回调请求 |
| `http_response` | client → server | 回传 OpenClaw 的处理结果 |
| `ping` | server → client | 心跳检测（每 30s） |
| `pong` | client → server | 心跳响应 |

### 3.2 relay-server (`relay/cmd/relay-server/main.go`)

远端中继服务，部署在有公网 IP 的服务器上。

#### 核心数据结构

```go
type relay struct {
    secret  string                              // 共享密钥

    mu      sync.RWMutex                        // 保护 conn 和 done
    conn    *websocket.Conn                     // 当前客户端连接（单客户端）
    writeMu sync.Mutex                          // 序列化 WebSocket 写操作
    done    chan struct{}                        // 当前客户端断开时关闭

    pendingMu sync.Mutex                        // 保护 pending map
    pending   map[string]chan protocol.Message   // 等待响应的请求
}
```

#### 请求处理流程

```
handleCallback(HTTP POST)
    │
    ├─ 检查 client 是否在线 ──[否]──▶ 返回 {"errCode":0}
    │
    ├─ 读取请求 body (限 1MB)
    │
    ├─ 生成唯一 reqID (crypto/rand, 32 hex chars)
    │
    ├─ 创建 response channel (buffer=1)，存入 pending map
    │
    ├─ 通过 WebSocket 发送 http_request 消息
    │
    └─ select 等待:
        ├─ <-ch          ──▶ 收到响应，转发给蓝信
        ├─ <-done        ──▶ 客户端断线，返回默认成功
        └─ <-2500ms      ──▶ 超时，返回默认成功
```

#### 客户端连接管理

- 仅支持单个 client 连接（后续可扩展）
- 新 client 连接会**替换**旧 client：关闭旧连接、关闭旧 `done` channel
- 连接建立后启动两个 goroutine：
  - `readLoop`：读取 client 发来的消息（pong / http_response）
  - `pingLoop`：每 30s 发送 ping

#### 超时与容错

- **2.5s 请求超时**：给蓝信的 3s 限制留 500ms 余量
- **90s 读超时**：如果 90s 内没收到任何消息（包括 pong），视为连接死亡
- **client 不在线**：直接返回 `{"errCode":0}` 给蓝信，消息丢失但不触发重试
- **写失败**：返回默认成功响应给蓝信

#### HTTP 路由

| 路径 | 方法 | 功能 |
|------|------|------|
| `/health` | GET | 健康检查，返回 `{"ok":true,"clientConnected":bool}` |
| `/*` (其他所有路径) | POST | 蓝信回调入口，路径透传给 client |

### 3.3 relay-client (`relay/cmd/relay-client/main.go`)

本地中继客户端，与 OpenClaw 运行在同一台机器上。

#### 连接生命周期

```
main()
  │
  └─ for {
        connect()
          ├─ WebSocket Dial (10s 握手超时)
          ├─ 发送 auth 消息
          └─ 等待 auth_ok (10s 读超时)

        run()  // 阻塞直到连接断开
          └─ 读消息循环:
               ├─ ping  → 回复 pong
               └─ http_request → goroutine 处理

        断线后重连 (指数退避: 1s → 2s → 4s → ... → 30s)
     }
```

#### HTTP 转发逻辑

```
handleRequest(msg)
    │
    ├─ 构造 URL: target + msg.Path [+ "?" + msg.Query]
    │   例: http://localhost:18789 + /lanxin + ?timestamp=xxx&nonce=yyy&signature=zzz
    │
    ├─ 构造 HTTP 请求，设置 headers（从原始请求透传）
    │
    ├─ 发送到 OpenClaw (5s 超时)
    │
    └─ 将响应通过 WebSocket 回传 (http_response)
```

关键：**路径和查询参数完全透传**，relay 不解析/修改蓝信的加密数据，保持对业务的零感知。

## 4. 并发与线程安全

### 4.1 relay-server 锁设计

| 锁 | 类型 | 保护对象 | 使用场景 |
|---|------|---------|---------|
| `mu` | `sync.RWMutex` | `conn`, `done` | 读：handleCallback 获取连接；写：handleWS 替换连接、readLoop 清理 |
| `writeMu` | `sync.Mutex` | WebSocket 写操作 | handleCallback 发请求、pingLoop 发 ping（gorilla/websocket 不支持并发写） |
| `pendingMu` | `sync.Mutex` | `pending` map | handleCallback 注册/清理、readLoop 分发响应 |

### 4.2 请求-响应匹配

- 每个 HTTP 回调生成唯一的 `reqID`（32 字符 hex）
- 创建 `chan protocol.Message`（buffer=1），以 reqID 为 key 存入 pending map
- readLoop 收到 `http_response` 时，按 ID 查找 channel 并发送
- HTTP handler 通过 select 等待，超时或断线时从 pending 中清理

**竞态安全保证**：

1. response channel buffer=1 → readLoop 写入不阻塞
2. HTTP handler 的 defer 确保 pending 一定被清理
3. `done` channel 提供连接断开的即时通知，避免等到超时

### 4.3 relay-client 并发

- 主 goroutine 负责读循环（`run()`）
- 每个 `http_request` 在独立 goroutine 中处理（`go c.handleRequest(msg)`）
- 写 WebSocket 通过 `writeMu` 序列化（pong + http_response 可能并发）

## 5. 配置参数

### 5.1 relay-server

| 参数 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| `-http-addr` | `LX_HTTP_ADDR` | `:8088` | 接收蓝信回调的 HTTP 监听地址 |
| `-ws-addr` | `LX_WS_ADDR` | `:8087` | relay-client 连接的 WebSocket 监听地址 |
| `-secret` | `LX_RELAY_SECRET` | `lx-relay-s3cret!` | 共享认证密钥 |

### 5.2 relay-client

| 参数 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| `-server` | `LX_RELAY_SERVER` | `ws://localhost:8087/ws` | relay-server 的 WebSocket 地址 |
| `-target` | `LX_RELAY_TARGET` | `http://localhost:18789` | OpenClaw 本地 HTTP 基础地址 |
| `-secret` | `LX_RELAY_SECRET` | `lx-relay-s3cret!` | 共享认证密钥 |

### 5.3 OpenClaw lanxin 插件相关配置

插件本身不需要修改，但需要确保以下配置正确：

```yaml
# openclaw.yaml 中的 channels.lanxin 配置
channels:
  lanxin:
    appId: "你的蓝信应用ID"
    appSecret: "你的蓝信应用密钥"
    gatewayUrl: "https://apigw.lanxin.cn"  # 蓝信 API 网关（发消息用，与中继无关）
    callbackKey: "回调密钥（AES key）"
    callbackSignToken: "回调签名令牌"
    webhookPath: "/lanxin"                 # 需与蓝信后台配置的回调路径一致
```

蓝信开发者后台的回调地址应配置为：`https://你的公网服务器:8088/lanxin`

## 6. 数据流详解

### 6.1 消息接收（蓝信 → OpenClaw）

```
 时间线    蓝信服务器          relay-server           relay-client          OpenClaw
   │
   │      POST /lanxin ────▶ 收到回调
   │      (加密数据)          生成 reqID
   │                          创建 pending[reqID]
   │                          ───[WS: http_request]──▶ 收到请求
   │                                                   POST localhost:18789/lanxin ──▶ 验签解密
   │                                                                                   解析事件
   │                                                   ◀── HTTP 200 {"errCode":0} ────  派发 agent
   │                          ◀──[WS: http_response]── 回传响应
   │      ◀── HTTP 200 ───── 返回给蓝信
   │
   │      ◀────────────────── 整个过程 < 2.5s ──────────────────────────────▶
```

### 6.2 消息发送（OpenClaw → 蓝信）

不经过中继，直接调用蓝信 API：

```
OpenClaw lanxin plugin
    │
    ├─ getLanxinAppToken() → 获取 app_token
    │
    └─ sendLanxinPrivateMessage() / sendLanxinGroupMessage()
        └─ POST https://apigw.lanxin.cn/v1/bot/messages/create?app_token=xxx
```

### 6.3 连接建立

```
 relay-client                    relay-server
    │                                │
    ├─ WebSocket Dial (:8087/ws) ──▶ │
    │                                ├─ Upgrade
    │                                │
    ├─ {"type":"auth",            ──▶ │
    │    "secret":"xxx"}              ├─ 验证密钥
    │                                │
    │  ◀── {"type":"auth_ok"} ────── │
    │                                │
    │   ═══ 连接就绪，开始转发 ═══     │
    │                                │
    │  ◀── {"type":"ping"} ───────── │  (每 30s)
    ├─ {"type":"pong"} ───────────▶  │
```

## 7. 错误处理与边界情况

| 场景 | 处理方式 |
|------|---------|
| relay-client 未连接，蓝信发回调 | server 返回 `{"errCode":0}` 给蓝信（消息丢失，不触发重试） |
| relay-client 处理超时 (>2.5s) | server 返回 `{"errCode":0}` 给蓝信，client 的迟到响应被丢弃 |
| relay-client 断线 | 正在等待的 HTTP handler 通过 `done` channel 立即感知，返回默认响应；client 自动重连 |
| WebSocket 写失败 | server 返回默认成功响应；client 记录日志 |
| OpenClaw 本地服务不可达 | client 返回 502 状态码，server 将其转发给蓝信 |
| 新 client 连接替换旧 client | 旧连接被关闭，旧 `done` channel 被关闭（唤醒所有等待中的 handler） |
| 密钥不匹配 | server 发送 `auth_fail` 并关闭连接，client 重试（指数退避） |

## 8. 文件结构

```
relay/
├── go.mod                          # Go module (lx-relay)
├── go.sum
├── protocol/
│   └── message.go                  # 共享消息类型定义
├── cmd/
│   ├── relay-server/
│   │   └── main.go                 # 远端中继服务 (~310 行)
│   └── relay-client/
│       └── main.go                 # 本地中继客户端 (~190 行)
└── README.md                       # 使用说明

lanxin/                             # 现有 OpenClaw 蓝信插件 (不修改)
├── index.ts                        # 插件入口
├── src/
│   ├── channel.ts                  # channel 定义 (capabilities, outbound, gateway)
│   ├── monitor.ts                  # webhook handler (核心: 接收/解密/派发)
│   ├── crypto.ts                   # 蓝信回调签名验证 + AES 解密
│   ├── api.ts                      # 蓝信 API 调用 (token, 发消息, 媒体)
│   ├── send.ts                     # 发送消息封装
│   ├── config-schema.ts            # 配置 schema (zod)
│   ├── types.ts                    # 类型定义
│   ├── accounts.ts                 # 多账户管理
│   ├── token.ts                    # app_token 获取
│   ├── probe.ts                    # 连通性探测
│   ├── onboarding.ts               # 交互式配置向导
│   ├── runtime.ts                  # 插件运行时
│   └── media-tags.ts               # 媒体标签解析
├── package.json
└── openclaw.plugin.json
```

## 9. 未来扩展点

### 9.1 多客户端支持

当前仅支持单个 relay-client。扩展为多客户端时需要：

- server 维护 `map[string]*clientConn`（按客户端 ID）
- HTTP 回调需要路由规则决定转发给哪个 client（按蓝信 appId、orgId 等）
- 可考虑广播给所有 client 或按配置路由

### 9.2 消息持久化

当 client 不在线时，当前直接丢弃消息。可改为：

- server 将未送达的消息存入队列（内存/Redis/文件）
- client 重连后批量拉取
- 配合蓝信的事件 ID 做去重

### 9.3 TLS 加密

当前 WebSocket 使用明文。生产环境建议：

- relay-server 的 WebSocket 端口使用 wss://（TLS）
- 可通过 nginx/caddy 反向代理提供 TLS 终止
- HTTP 端口同理，使用 https://

### 9.4 认证增强

当前使用静态共享密钥。可改为：

- HMAC 签名认证（时间戳 + nonce + 密钥）
- mTLS 双向证书认证
- JWT token（适合多客户端场景）

### 9.5 监控与可观测性

- 添加 Prometheus metrics（连接数、请求延迟、超时率、转发成功率）
- 结构化日志（JSON 格式）
- 添加 request tracing（在 headers 中传递 trace-id）

### 9.6 双向中继

当前中继仅用于入站（蓝信 → OpenClaw）。如果蓝信 API 网关也不可直接访问，可扩展为：

- client 也可以通过 WebSocket 发送出站请求
- server 代理调用蓝信 API 并返回结果
