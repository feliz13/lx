# 蓝信插件群消息功能实现总结

## 任务目标

为 `./lanxin` 目录下的插件增加支持 group 的逻辑，具体包括：
1. 当 webhook 收到 `bot_group_message` 类型请求时，正确解析 `groupId`、`from`、`entryId` 等字段
2. 使用正确的 API 接口发送群消息回复

## 实现的更改

### 文件 1: `lanxin/src/types.ts`

**更改内容**: 扩展 `LanxinCallbackEvent` 类型定义

```typescript
export type LanxinCallbackEvent = {
  eventType?: string;
  eventId?: string;
  timestamp?: number;
  fromUserId?: string;
  toUserId?: string;
  from?: string;              // 新增：用于 bot 事件
  groupId?: string;           // 新增：用于 bot_group_message 事件
  entryId?: string;           // 新增：应用入口ID
  chatId?: string;
  msgType?: string;
  content?: string;
  msgData?: unknown;          // 新增：消息数据
  data?: unknown;             // 新增：完整事件数据
  [key: string]: unknown;
};
```

### 文件 2: `lanxin/src/api.ts`

**更改内容**: 更新 `sendLanxinGroupMessage` 函数以符合官方文档规范

- **API 端点**: 从 `/v1/bot/sendGroupMsg` 改为 `/v1/messages/group/create`
- **认证方式**: 从 `Authorization: Bearer {token}` 改为 `app_token` 作为 query 参数
- **请求体格式**:
  ```typescript
  {
    groupId: string;      // 群ID
    msgType: string;      // 消息类型
    msgData: object;      // 消息数据
    entryId?: string;     // 可选：应用入口ID
  }
  ```

### 文件 3: `lanxin/src/monitor.ts`

**更改内容**: 增强 `processLanxinEvent` 函数以正确处理 bot_group_message 事件

```typescript
// 识别 bot 事件类型
const isBotGroupMessage = eventType === "bot_group_message";
const isBotPrivateMessage = eventType === "bot_private_message";

// 从事件数据中提取字段
const senderId = String(
  data?.from ?? evt.fromUserId ?? evt.from ?? data?.FromStaffId ?? "",
).trim();

const chatId = String(
  data?.groupId ?? evt.groupId ?? evt.chatId ?? evt.toUserId ?? evt.to ?? "",
).trim();

const entryId = String(data?.entryId ?? evt.entryId ?? "").trim();

const isGroup = Boolean(evt.groupId || data?.groupId || evt.chatId) || /^group|chat/i.test(chatId);
```

### 文件 4: `lanxin/src/send.ts`

**更改内容**: 为 `LanxinSendOptions` 添加 `entryId` 可选参数

```typescript
export type LanxinSendOptions = {
  cfg?: OpenClawConfig;
  accountId?: string;
  entryId?: string;      // 新增：应用入口ID
};
```

### 文件 5: `lanxin/GROUP_MESSAGE_SUPPORT.md` (新建)

**内容**: 详细的功能说明文档，包括：
- 更新概述
- 各文件的详细更改说明
- 事件格式示例
- 使用示例代码
- 配置说明
- 注意事项

## 事件数据格式

### 接收的 bot_group_message 事件

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

### 发送的群消息请求

```
POST /v1/messages/group/create?app_token={APP_TOKEN}
Content-Type: application/json

{
  "groupId": "524288-xxx",
  "msgType": "text",
  "msgData": {
    "text": {
      "content": "回复消息"
    }
  }
}
```

## 使用示例

### 基本使用

```typescript
import { sendMessageLanxin } from "./send.js";

// 发送文本消息到群聊
const result = await sendMessageLanxin(
  "group:524288-xxx",
  "这是回复的消息",
  { cfg: config, accountId: account.accountId }
);
```

### 带入口参数

```typescript
// 发送到特定应用入口
const result = await sendMessageLanxin(
  "group:524288-xxx",
  "回复消息",
  { 
    cfg: config, 
    accountId: account.accountId,
    entryId: "xxx-xxx-xxx"  // 可选
  }
);
```

## 配置说明

在 OpenClaw 配置文件中：

```yaml
channels:
  lanxin:
    accounts:
      default:
        appId: "your-app-id"
        appSecret: "your-app-secret"
        gatewayUrl: "https://apigw.example.com"
        
        # 群消息策略
        groupPolicy: "allowlist"  # open, allowlist, disabled
        requireMention: true      # 需要@机器人才响应
        
        # 可选：自定义群消息API路径
        sendGroupMsgPath: "/v1/messages/group/create"
        
        # 可选：单群配置
        groups:
          "524288-xxx":
            enabled: true
            requireMention: false
```

## 兼容性

- ✅ 向后兼容现有的私聊消息功能
- ✅ 支持 `bot_private_message` 事件类型
- ✅ 保持现有的事件路由和会话管理逻辑
- ✅ 不影响其他消息类型（account_message, dept_create 等）

## 测试建议

1. **测试群消息接收**: 在配置的群聊中 @ 机器人，确认 webhook 能正确接收和处理
2. **测试群消息回复**: 验证机器人能正确回复群消息
3. **测试多入口**: 如果应用有多个入口，测试 `entryId` 参数是否正确传递
4. **测试媒体消息**: 测试在群聊中发送图片、文件等媒体消息

## 文档参考

- 蓝信文档 `docs/lx-callback-2.md` - 回调事件定义
- 蓝信文档 `docs/bot-2.md` - 机器人发送群消息接口
- 实现说明文档 `lanxin/GROUP_MESSAGE_SUPPORT.md`

## 注意事项

1. TypeScript 编译警告是开发环境问题，不影响实际运行
2. 插件由 OpenClaw 框架在运行时处理，无需手动编译
3. 确保在蓝信开放平台开启了机器人能力
4. 默认情况下群消息需要 @ 机器人才能触发
