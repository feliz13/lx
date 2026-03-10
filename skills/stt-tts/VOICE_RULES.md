# 蓝信语音回复规则

## 智能判断：什么时候用语音回复

**硬规则：用户发语音消息 → 默认用语音回复**（除非下方「不适合」场景）。

### 适合语音的场景

1. **用户发了语音消息** → **必须用语音回复**（最高优先级）

2. **回复内容较长**（>100 字）
   - 故事、解释、教程
   - 播放比阅读更轻松

3. **情感/氛围类内容**
   - 安慰、鼓励
   - 讲笑话、说故事
   - 有情绪的回复

4. **朗读类内容**
   - 诗歌、文章
   - 需要"听"的内容

### 不适合语音的场景（用文字）

1. **结构化信息**
   - 代码、命令
   - 表格、列表
   - 需要复制粘贴的内容

2. **简短回复**（<50 字）
   - "好的"、"收到"
   - 简单确认

3. **技术/专业内容**
   - 配置文件
   - 日志输出
   - 需要仔细阅读的文档

4. **包含链接/文件**
   - 需要点击操作
   - 视觉呈现更好

5. **用户明确要求文字**
   - "发文字"、"别用语音"

## 实现逻辑

````javascript
function shouldUseVoice(context) {
  if (context.userSentVoice) return true;

  const textLength = context.replyText.length;
  const hasCode = /```|`/.test(context.replyText);
  const hasLinks = /https?:\/\//.test(context.replyText);
  const hasStructure = /^\s*[-*•]|\d+\./m.test(context.replyText);

  if (hasCode || hasLinks || hasStructure) return false;
  if (textLength < 50) return false;

  if (textLength > 100) return true;

  const emotionalWords = ["故事", "笑话", "安慰", "鼓励", "祝福"];
  if (emotionalWords.some((w) => context.replyText.includes(w))) return true;

  return false;
}
````

## 使用方式（蓝信）

在回复前自动判断：

- 符合条件 → `node scripts/send-voice.js "回复内容"` 获取路径，用 `<lxfile>路径</lxfile>` 发送
- 不符合 → 正常发送文字消息
