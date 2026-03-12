# OpenRouter 专用代理

本目录提供一个仅用于 OpenRouter 的专用代理服务，满足：

1. OpenClaw 继续使用内置 OpenRouter provider（配置不变）。
2. 只在 OpenClaw 机器上通过 `/etc/hosts` 改 `openrouter.ai` 解析到代理机。
3. 保持 HTTPS 链路兼容（客户端仍然访问 `https://openrouter.ai/...`）。

## 设计说明

该代理使用 **TCP 透明转发**（四层代理）：

- 监听本地 `:443`
- 将所有字节流转发到 `openrouter.ai:443`
- 不解密 TLS、不改请求头、不过滤路径

这样客户端 TLS 会话仍然与官方 OpenRouter 终端建立，避免证书不匹配问题。

## 文件

- `main.go`: 专用 TCP 代理实现（仅转发到 OpenRouter）
- `go.mod`: 独立 Go 模块定义

## 启动

```bash
cd openrouter-proxy
go run .
```

默认参数：

- `LISTEN_ADDR=:443`
- `UPSTREAM_HOST=openrouter.ai`
- `UPSTREAM_PORT=443`
- `DIAL_TIMEOUT_SECONDS=10`

示例（自定义监听端口）：

```bash
LISTEN_ADDR=":8443" go run .
```

## OpenClaw 机器配置

在 OpenClaw 所在机器中添加 hosts（把 `10.0.0.20` 替换为代理机 IP）：

```text
10.0.0.20 openrouter.ai
```

如果你监听的是 `443`，OpenClaw 无需改动 URL，继续请求：

```text
https://openrouter.ai/api/v1/chat/completions
```

## 验证

在 OpenClaw 机器执行（确保 DNS 指向代理）：

```bash
curl https://openrouter.ai/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -d '{
  "model": "openai/gpt-5.2",
  "messages": [
    {
      "role": "user",
      "content": "What is the meaning of life?"
    }
  ]
}'
```

当代理机日志出现连接记录且请求成功返回，即表示链路打通。
