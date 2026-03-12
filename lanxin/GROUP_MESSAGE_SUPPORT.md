# 蓝信插件群消息支持说明

## 更新概述

本次更新为蓝信插件添加了对 `bot_group_message` 事件类型的完整支持，能够正确解析群聊回调并发送群消息回复。

## 更新内容

### 1. 类型定义更新 (`src/types.ts`)

`LanxinCallbackEvent` 类型新增以下字段：
- `from?: string` - 发送者ID（用于 bot 事件）
- `groupId?: string` - 群ID（用于 bot_group_message 事件）
- `entryId?: string` - 应用入口ID
- `msgData?: unknown` - 消息数据
- `data?: unknown` - 完整事件数据

### 2. API 更新 (`src/api.ts`)

`sendLanxinGroupMessage` 函数更新：
- **API 端点**: `/v1/messages/group/create`
- **认证方式**: `app_token` 作为 query 参数
- **请求体格式**:
  ```json
  {
    "groupId": "群ID",
    "entryId": "应用入口ID (可选)",
    "msgType": "text",
    "msgData": {
      "text": {
        "content": "消息内容",
        "mediaType": 2,  // 可选，用于媒体消息
        "mediaIds": ["mediaId1"]  // 可选
      }
    }
  }
  ```

### 3. Webhook 处理更新 (`src/monitor.ts`)

`processLanxinEvent` 函数增强：
- 识别 `bot_group_message` 事件类型
- 从事件数据中提取 `groupId` 作为群聊ID
- 从事件数据中提取 `entryId` 用于回复时指定入口
- 正确处理群聊消息路由

### 4. 发送选项更新 (`src/send.ts`)

`LanxinSendOptions` 类型新增：
- `entryId?: string` - 可选的应用入口ID

## 事件格式

### bot_group_message 事件数据结构

```json
{
  "eventType": "bot_group_message",
  "groupId": "524288-xxx",
  "from": "524288-yyy",
  "entryId": "xxx-xxx-xxx",
  "msgType": "text",
  "msgData": {
    "text": {
      "content": "@智能机器人",
      "sendTime": "1540377644020456"
    }
  }
}
```

## 使用示例

### 接收群消息

当用户在群聊中 @ 机器人时，系统会自动接收并处理 `bot_group_message` 事件。

### 发送群消息回复

```typescript
// 文本消息回复
const result = await sendMessageLanxin(
  "group:524288-xxx",
  "这是回复的消息",
  { cfg: config, accountId: account.accountId }
);

// 带入口的回复
const resultWithEntry = await sendMessageLanxin(
  "group:524288-xxx",
  "回复消息",
  { 
    cfg: config, 
    accountId: account.accountId,
    entryId: "xxx-xxx-xxx"  // 可选
  }
);
```

### 媒体消息回复

```typescript
const result = await sendMediaLanxin(
  "group:524288-xxx",
  "图片说明",
  "https://example.com/image.jpg",
  { cfg: config, accountId: account.accountId }
);
```

## 配置说明

在 `channels.lanxin` 配置中，可以设置：

```yaml
channels:
  lanxin:
    accounts:
      default:
        appId: "your-app-id"
        appSecret: "your-app-secret"
        gatewayUrl: "https://apigw.example.com"
        callbackKey: "your-callback-key"
        callbackSignToken: "your-sign-token"
        
        # 群消息策略
        groupPolicy: "allowlist"  # 或 "open", "disabled"
        groupAllowFrom: ["user1", "user2"]
        requireMention: true  # 需要@机器人
        
        # 可选：自定义群消息API路径
        sendGroupMsgPath: "/v1/messages/group/create"
        
        # 可选：单群配置
        groups:
          "524288-xxx":
            enabled: true
            requireMention: false  # 此群不需要@
            users: ["allowed-user1", "allowed-user2"]
```

## 注意事项

1. **认证**: 群消息和私聊消息使用相同的 `app_token` 进行认证
2. **entryId**: 大部分应用只有一个入口，可以忽略 `entryId` 字段
3. **群消息路径**: 默认使用 `/v1/messages/group/create`，如需修改可通过 `sendGroupMsgPath` 配置
4. **@提及**: 默认情况下，群消息需要 @ 机器人才会触发（`requireMention: true`）
5. **消息内容**: 文本消息最大长度限制为 4000 字符

## 兼容性

- 向后兼容原有的私聊消息功能
- 支持 `bot_private_message` 事件类型
- 支持现有的事件路由和会话管理
