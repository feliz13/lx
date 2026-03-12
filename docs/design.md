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

### 2.2 最终架构（多客户端）

```
                          ┌──────────────────────────────┐
                          │       公网服务器               │
                          │                              │
蓝信服务器 ─[HTTP POST]─▶ │  relay-server                │
                          │  ├─ :8088 HTTP (接收回调)     │
                          │  ├─ :8087 WebSocket (客户端)  │
                          │  ├─ 解密回调 → 提取路由信息    │
                          │  └─ openId 路由表             │
                          └──┬────────┬────────┬─────────┘
                             │        │        │
                        [WS 长连接] [WS]     [WS]
                             │        │        │
                       ┌─────┴──┐ ┌───┴──┐ ┌───┴──┐
                       │client-A│ │  B   │ │  C   │
                       │用户1   │ │用户2 │ │群组1 │
                       └───┬────┘ └──┬───┘ └──┬───┘
                           │        │        │
                       OpenClaw  OpenClaw  OpenClaw
```

## 3. 组件设计

### 3.1 共享协议 (`relay/protocol/message.go`)

server 与 client 之间通过 WebSocket 交换 JSON 消息，统一使用 `Message` 结构体：

```go
type Message struct {
    Type    string            `json:"type"`
    ID      string            `json:"id,omitempty"`
    Method  string            `json:"method,omitempty"`
    Path    string            `json:"path,omitempty"`
    Query   string            `json:"query,omitempty"`
    Headers map[string]string `json:"headers,omitempty"`
    Body    string            `json:"body,omitempty"`
    Status  int               `json:"status,omitempty"`
    Secret  string            `json:"secret,omitempty"`
    Error   string            `json:"error,omitempty"`
    OpenIds []string          `json:"openIds,omitempty"`
}
```

消息类型：

| type | 方向 | 用途 |
|------|------|------|
| `auth` | client → server | 连接后发送密钥 + openIds 注册 |
| `auth_ok` | server → client | 认证成功 |
| `auth_fail` | server → client | 认证失败（密钥错误或缺少 openIds），连接关闭 |
| `http_request` | server → client | 转发蓝信的 HTTP 回调请求（加密原文） |
| `http_response` | client → server | 回传 OpenClaw 的处理结果 |
| `ping` | server → client | 心跳检测（每 30s） |
| `pong` | client → server | 心跳响应 |

### 3.2 服务端配置 (`relay/internal/config/config.go`)

relay-server 通过 JSON 配置文件启动，包含蓝信应用信息（用于解密和错误回复）：

```go
type AccountConfig struct {
    AppId             string `json:"appId"`
    AppSecret         string `json:"appSecret"`
    GatewayUrl        string `json:"gatewayUrl"`
    CallbackKey       string `json:"callbackKey"`       // AES 解密密钥
    CallbackSignToken string `json:"callbackSignToken"`  // 签名验证令牌
}

type ServerConfig struct {
    Secret   string                    `json:"secret"`    // client 认证密钥
    HttpAddr string                    `json:"httpAddr"`   // 默认 :8088
    WsAddr   string                    `json:"wsAddr"`     // 默认 :8087
    Accounts map[string]*AccountConfig `json:"accounts"`   // 蓝信应用账户
}
```

accounts 中的 `callbackKey`/`callbackSignToken` 与 OpenClaw lanxin 插件配置一致，用于：
- 签名验证：确认回调来自蓝信
- AES 解密：提取事件类型和路由字段
- API 调用（appId/appSecret/gatewayUrl）：当无匹配 client 时发送错误回复

### 3.3 蓝信加解密 (`relay/internal/crypto/crypto.go`)

从 lanxin 插件的 `crypto.ts` 移植到 Go：

**签名验证**：
```
signature = sha1(sort(signToken, timestamp, nonce, dataEncrypt))
```

**AES 解密**：
```
ciphertext = Base64Decode(dataEncrypt)
keyBytes = Base64Decode(aesKey + "=")[:32]
iv = keyBytes[:16]
AES-256-CBC decrypt → skip 20 bytes header → find first '{' → extract JSON object
```

解密后的 JSON 结构：
```json
{
    "appId": "2990080-14155776",
    "orgId": "2990080",
    "events": [{
        "id": "xxx",
        "eventType": "bot_private_message",
        "data": {
            "from": "524288-userOpenId",
            "msgType": "text",
            "msgData": { "text": { "content": "hello" } }
        }
    }]
}
```

### 3.4 蓝信 API (`relay/internal/lanxin/api.go`)

用于当无匹配 client 时，server 直接回复"无可用服务"。

- **GetAppToken**：`GET gatewayUrl/v1/apptoken/create?grant_type=client_credential&appid=x&secret=y`
  - 带缓存，提前 1 分钟刷新
- **SendPrivateMessage**：`POST gatewayUrl/v1/bot/messages/create?app_token=xxx`
  - body: `{"userIdList":["userId"],"msgType":"text","msgData":{"text":{"content":"..."}}}`
- **SendGroupMessage**：`POST gatewayUrl/v1/messages/group/create?app_token=xxx`
  - body: `{"groupId":"gid","msgType":"text","msgData":{"text":{"content":"..."}}}`

### 3.5 relay-server (`relay/cmd/relay-server/main.go`)

#### 核心数据结构

```go
type clientConn struct {
    conn    *websocket.Conn
    writeMu sync.Mutex
    done    chan struct{}
    openIds []string          // 该 client 注册的 openId 列表
}

type relay struct {
    cfg     *config.ServerConfig

    mu      sync.RWMutex
    clients map[*clientConn]struct{}       // 所有连接的 client
    idIndex map[string]*clientConn         // openId → client 快速查找

    pendingMu sync.Mutex
    pending   map[string]chan protocol.Message  // reqID → response channel
}
```

#### 回调处理流程（多客户端路由）

```
handleCallback(HTTP POST)
    │
    ├─ 读取请求 body，提取 dataEncrypt
    │
    ├─ resolveRoute():
    │    ├─ 遍历 accounts，验证签名
    │    ├─ 匹配后 AES 解密（解密内容仅用于路由 + 日志）
    │    ├─ 解析 events:
    │    │    ├─ bot_private_message → routeKey = from
    │    │    └─ bot_group_message  → routeKey = groupId
    │    └─ 返回 routeResult{eventType, routeKey, from, groupId, account}
    │
    ├─ findClient(routeKey):
    │    └─ 在 idIndex 中查找 openId 对应的 client
    │
    ├─ [有匹配 client] → forwardToClient():
    │    ├─ 将原始加密请求完整转发（method, path, query, headers, body）
    │    └─ select 等待响应 / 超时 / 断线
    │
    └─ [无匹配 client] → replyNoHandler():
         ├─ bot_private_message → SendPrivateMessage(from, "抱歉...")
         └─ bot_group_message  → SendGroupMessage(groupId, "抱歉...")
```

**关键设计**：server 转发给 client 的始终是**加密的原始 HTTP 请求**。解密仅用于：
1. 确定路由目标（提取 from / groupId）
2. 日志输出（方便调试）

#### 客户端注册

```
handleWS():
    │
    ├─ WebSocket Upgrade
    ├─ 读取 auth 消息（10s 超时）
    ├─ 验证 secret
    ├─ 验证 openIds 非空
    ├─ registerClient():
    │    ├─ 加入 clients set
    │    └─ 为每个 openId 建立 idIndex 映射
    ├─ 启动 readLoop + pingLoop
    │
    断开时 → unregisterClient():
         ├─ 从 clients 移除
         └─ 清理 idIndex（仅当指向自己时）
```

同一个 openId 被新 client 注册时，会替换旧的映射。

### 3.6 relay-client (`relay/cmd/relay-client/main.go`)

相比之前的版本，新增 `-open-ids` 参数：

```
./relay-client \
  -server ws://server:8087/ws \
  -target http://localhost:18789 \
  -secret "xxx" \
  -open-ids "524288-userA,524288-groupX"
```

认证消息中携带 openIds：
```json
{"type":"auth", "secret":"xxx", "openIds":["524288-userA","524288-groupX"]}
```

其余逻辑不变：收到 `http_request` → POST 到本地 OpenClaw → 返回 `http_response`。

## 4. 并发与线程安全

### 4.1 relay-server 锁设计

| 锁 | 类型 | 保护对象 | 使用场景 |
|---|------|---------|---------|
| `mu` | `sync.RWMutex` | `clients`, `idIndex` | 读：findClient 路由查找；写：register/unregister |
| `clientConn.writeMu` | `sync.Mutex` | 单个 client 的 WebSocket 写 | forwardToClient、pingLoop |
| `pendingMu` | `sync.Mutex` | `pending` map | handleCallback 注册/清理、readLoop 分发响应 |

### 4.2 请求-响应匹配

- 每个 HTTP 回调生成唯一的 `reqID`（32 字符 hex）
- 创建 `chan protocol.Message`（buffer=1），以 reqID 为 key 存入 pending map
- 每个 client 的 readLoop 收到 `http_response` 时，按 ID 查找 channel 并发送
- HTTP handler 通过 select 等待，超时或断线时从 pending 中清理

### 4.3 relay-client 并发

- 主 goroutine 负责读循环（`run()`）
- 每个 `http_request` 在独立 goroutine 中处理
- 写 WebSocket 通过 `writeMu` 序列化

## 5. 配置参数

### 5.1 relay-server

通过 `-config` 指定配置文件路径（默认 `config.json`，环境变量 `LX_RELAY_CONFIG`）。

配置文件字段：

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `secret` | `lx-relay-s3cret!` | client 连接认证密钥 |
| `httpAddr` | `:8088` | 蓝信回调监听地址 |
| `wsAddr` | `:8087` | WebSocket 监听地址 |
| `accounts` | (必填) | 蓝信应用账户 map |

accounts 中每个账户：

| 字段 | 说明 |
|------|------|
| `appId` | 蓝信应用 ID（必填） |
| `appSecret` | 蓝信应用密钥（必填） |
| `gatewayUrl` | 蓝信 API 网关地址（必填） |
| `callbackKey` | 回调 AES 解密密钥（必填） |
| `callbackSignToken` | 回调签名验证令牌（必填） |

### 5.2 relay-client

| 参数 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| `-server` | `LX_RELAY_SERVER` | `ws://localhost:8087/ws` | relay-server 的 WebSocket 地址 |
| `-target` | `LX_RELAY_TARGET` | `http://localhost:18789` | OpenClaw 本地 HTTP 基础地址 |
| `-secret` | `LX_RELAY_SECRET` | `lx-relay-s3cret!` | 认证密钥 |
| `-open-ids` | `LX_RELAY_OPEN_IDS` | (必填) | 逗号分隔的 openId 列表 |

### 5.3 OpenClaw lanxin 插件相关配置

插件本身不需要修改，但需要确保以下配置正确：

```yaml
channels:
  lanxin:
    appId: "你的蓝信应用ID"
    appSecret: "你的蓝信应用密钥"
    gatewayUrl: "https://apigw.lanxin.cn"
    callbackKey: "回调密钥（AES key）"
    callbackSignToken: "回调签名令牌"
    webhookPath: "/lanxin"
```

蓝信开发者后台的回调地址配置为：`http://你的公网服务器:8088/lanxin`

## 6. 数据流详解

### 6.1 消息接收（蓝信 → OpenClaw，多客户端）

```
 时间线    蓝信服务器          relay-server                    relay-client          OpenClaw
   │
   │      POST /lanxin ────▶ 收到回调
   │      (加密数据)          验签 + 解密（仅用于路由）
   │                          eventType=bot_private_message
   │                          from=user-001
   │                          查找 idIndex["user-001"]
   │                          找到 client-A
   │                          ───[WS: http_request 原始加密]──▶ 收到请求
   │                                                            POST localhost:18789/lanxin ──▶ 验签解密
   │                                                                                            解析事件
   │                                                            ◀── HTTP 200 ────────────────── 派发 agent
   │                          ◀──[WS: http_response]─────────── 回传响应
   │      ◀── HTTP 200 ───── 返回给蓝信
```

### 6.2 无匹配客户端时的错误回复

```
 时间线    蓝信服务器          relay-server
   │
   │      POST /lanxin ────▶ 收到回调
   │      (加密数据)          验签 + 解密
   │                          eventType=bot_private_message
   │                          from=unknown-user
   │                          查找 idIndex["unknown-user"] → nil
   │      ◀── HTTP 200 ───── 返回给蓝信（先应答）
   │
   │                          [异步] GetAppToken()
   │                          [异步] SendPrivateMessage(unknown-user, "抱歉...")
   │                                         │
   │                                         ▼
   │                                    蓝信 API 网关
```

### 6.3 消息发送（OpenClaw → 蓝信）

不经过中继，直接调用蓝信 API：

```
OpenClaw lanxin plugin
    │
    ├─ getLanxinAppToken() → 获取 app_token
    │
    └─ sendLanxinPrivateMessage() / sendLanxinGroupMessage()
        └─ POST https://apigw.lanxin.cn/v1/bot/messages/create?app_token=xxx
```

### 6.4 连接建立（带 openId 注册）

```
 relay-client                         relay-server
    │                                     │
    ├─ WebSocket Dial (:8087/ws) ───────▶ │
    │                                     ├─ Upgrade
    │                                     │
    ├─ {"type":"auth",                 ──▶│
    │    "secret":"xxx",                   ├─ 验证密钥
    │    "openIds":["user-001","grp-X"]}   ├─ 注册 openIds → client 映射
    │                                     │
    │  ◀── {"type":"auth_ok"} ──────────── │
    │                                     │
    │   ═══ 连接就绪，开始接收路由消息 ═══    │
```

## 7. 错误处理与边界情况

| 场景 | 处理方式 |
|------|---------|
| 无匹配 client（bot_private_message） | server 通过蓝信 API 回复 "抱歉，当前没有可用的服务处理您的消息" |
| 无匹配 client（bot_group_message） | server 通过蓝信 API 向群发送同样的提示 |
| 非 bot 消息类型（dept_create 等） | 直接忽略，返回 200 |
| 签名验证全部失败 | 返回 200（不触发蓝信重试） |
| 解密失败 | 日志记录，返回 200 |
| client 处理超时 (>2.5s) | server 返回 200 给蓝信，client 的迟到响应被丢弃 |
| client 断线 | 正在等待的 handler 通过 `done` channel 立即感知；client 自动重连 |
| 同一 openId 被新 client 注册 | 新 client 替换旧映射，旧 client 仍保持连接但不再收到该 openId 的消息 |
| 密钥不匹配 | server 发送 `auth_fail` 并关闭连接，client 重试（指数退避） |
| 缺少 openIds | server 发送 `auth_fail` 并关闭连接 |
| 蓝信 API 调用失败（错误回复时） | 仅日志记录，不影响回调响应 |

## 8. 文件结构

```
relay/
├── go.mod
├── go.sum
├── Makefile
├── config.example.json               # 示例配置文件
├── protocol/
│   └── message.go                    # 共享消息类型（含 OpenIds 字段）
├── internal/
│   ├── config/
│   │   └── config.go                 # 配置加载与校验
│   ├── crypto/
│   │   └── crypto.go                 # 蓝信签名验证 + AES 解密（从 TS 移植）
│   └── lanxin/
│       └── api.go                    # 蓝信 API（token 缓存、发消息）
├── cmd/
│   ├── relay-server/
│   │   └── main.go                   # 多客户端中继服务
│   └── relay-client/
│       └── main.go                   # 客户端（带 openId 注册）
└── README.md

lanxin/                               # 现有 OpenClaw 蓝信插件（不修改）
├── index.ts
├── src/
│   ├── channel.ts
│   ├── monitor.ts                    # webhook handler
│   ├── crypto.ts                     # 签名验证 + AES 解密
│   ├── api.ts                        # 蓝信 API 调用
│   ├── send.ts
│   ├── config-schema.ts
│   ├── types.ts
│   ├── accounts.ts
│   ├── token.ts
│   ├── probe.ts
│   ├── onboarding.ts
│   ├── runtime.ts
│   └── media-tags.ts
├── package.json
└── openclaw.plugin.json
```

## 9. 未来扩展点

### 9.1 消息持久化

当 client 不在线时，当前回复"无可用服务"。可改为：

- server 将未送达的消息存入队列（内存/Redis/文件）
- client 重连后批量拉取
- 配合蓝信的事件 ID 做去重

### 9.2 TLS 加密

当前 WebSocket 使用明文。生产环境建议：

- relay-server 的 WebSocket 端口使用 wss://（TLS）
- 可通过 nginx/caddy 反向代理提供 TLS 终止
- HTTP 端口同理，使用 https://

### 9.3 认证增强

当前使用静态共享密钥。可改为：

- HMAC 签名认证（时间戳 + nonce + 密钥）
- mTLS 双向证书认证
- JWT token（适合多客户端场景）

### 9.4 监控与可观测性

- 添加 Prometheus metrics（连接数、请求延迟、超时率、转发成功率）
- 结构化日志（JSON 格式）
- 添加 request tracing（在 headers 中传递 trace-id）

### 9.5 双向中继

当前中继仅用于入站（蓝信 → OpenClaw）。如果蓝信 API 网关也不可直接访问，可扩展为：

- client 也可以通过 WebSocket 发送出站请求
- server 代理调用蓝信 API 并返回结果

### 9.6 动态 openId 管理

当前 openId 在 client 连接时一次性注册。可扩展为：

- 新增 `register_ids` / `unregister_ids` 消息类型
- client 可在连接期间动态增删 openId
- server 通过 API 或配置文件热加载 openId → client 映射
