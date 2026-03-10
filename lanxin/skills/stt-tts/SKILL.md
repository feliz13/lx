---
name: lanxin-stt-tts
description: 蓝信语音消息自动转录（STT）+ 智能语音回复（TTS），使用 ElevenLabs API。语音消息自动下载并转录，根据内容智能判断是否用语音回复。
homepage: https://elevenlabs.io
metadata:
  {
    "clawdbot":
      {
        "emoji": "🎙️",
        "requires": { "bins": ["curl", "jq", "node"], "env": ["ELEVENLABS_API_KEY"] },
        "primaryEnv": "ELEVENLABS_API_KEY",
      },
  }
---

# 蓝信 STT-TTS 技能

自动转录蓝信语音消息 + 智能语音回复，完整的语音交互闭环。

## 功能

### 1. STT（语音转文字）

- 蓝信语音消息自动下载到 `/tmp/openclaw-lanxin-inbound`
- 使用 ElevenLabs Scribe v2 转录（支持 90+ 语言）
- 智能语言检测（中英文自动识别）
- 支持 OGG/MP3/M4A/WAV/OPUS 格式

### 2. TTS（文字转语音）

- ElevenLabs v3 模型高质量语音合成
- 通过 `<lxfile>` 标签发送语音文件到蓝信
- 智能判断何时用语音回复（见 VOICE_RULES.md）

### 3. 智能语音回复规则

**重要：用户发语音消息时，优先用语音回复**（除非内容不适合，见下方「不适合」）。

**适合语音的场景：**

- **用户发了语音消息 → 必须用语音回复**（默认行为）
- 回复内容较长（>100字）→ 故事/解释/教程
- 情感/氛围类内容 → 安慰/鼓励/讲笑话

**不适合语音的场景：**

- 代码、命令、链接
- 简短回复（<50字）
- 结构化列表/表格
- 用户要求文字

## 配置

### 必需环境变量

```bash
export ELEVENLABS_API_KEY="sk_..."     # ElevenLabs API Key
```

### 可选配置

```bash
export ELEVENLABS_VOICE_ID="bhJUNIXWQQ94l8eI2VUf"  # 语音ID（默认自然中文）
```

## 使用方式

### 方式一：自动流程（推荐）

1. 用户发蓝信语音 → 系统下载到 `/tmp/openclaw-lanxin-inbound`，body 含路径且标记为「语音」
2. AI 调用 `transcribe.sh` 转录 → 理解内容并回复
3. AI 判断是否语音回复 → 调用 `send-voice.js` 生成 MP3 → 用 `<lxfile>路径</lxfile>` 发送

### 方式二：手动转录

```bash
# 本技能 scripts 目录下的 transcribe.sh
./scripts/transcribe.sh /tmp/openclaw-lanxin-inbound/xxx.ogg

# 指定语言
./scripts/transcribe.sh /path/to/audio.ogg --lang zh

# 启用说话人区分
./scripts/transcribe.sh /path/to/audio.ogg --diarize

# JSON 输出（含时间戳）
./scripts/transcribe.sh /path/to/audio.ogg --json
```

### 方式三：语音回复

```bash
# 1. 生成 MP3，输出路径到 stdout
node scripts/send-voice.js "要说的话"

# 2. 在回复中使用 <lxfile> 标签发送
# 例如：node scripts/send-voice.js "你好" 输出 /tmp/voice-xxx.mp3
# 则回复：<lxfile>/tmp/voice-xxx.mp3</lxfile>
```

## 工具调用指南（收到语音消息时必读）

当 body 含「【语音消息】」或路径标记为「（语音）」时：

1. **转录**：`<技能目录>/scripts/transcribe.sh <audio_path> --lang zh` 理解用户说了什么（技能目录即本 SKILL.md 所在目录）
2. **语音回复**：用户发语音 → **用语音回复**。执行 `node <技能目录>/scripts/send-voice.js "回复内容"` 获取 MP3 路径，在回复中写 `<lxfile>路径</lxfile>` 发送
3. **仅当内容不适合语音**（代码/表格/链接等）时才用文字，参考 VOICE_RULES.md

## 文件结构

```
stt-tts/
├── SKILL.md              # 本文件
├── VOICE_RULES.md        # 语音回复智能判断规则
├── package.json
├── lib/
│   └── transcriber.js    # STT 核心模块
└── scripts/
    ├── transcribe.sh     # STT 命令行脚本
    └── send-voice.js     # TTS 生成 MP3（输出路径，用 lxfile 发送）
```

## API 参考

### ElevenLabs STT (Scribe v2)

- 端点: `POST https://api.elevenlabs.io/v1/speech-to-text`
- 准确率: 95%+（中英文）
- 延迟: 2-5 秒
- 文件上限: 25MB / 2小时

### ElevenLabs TTS (v3)

- 端点: `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`
- 输出: MP3
- 延迟: 1-3 秒

## 故障排查

| 问题         | 原因               | 解决                                |
| ------------ | ------------------ | ----------------------------------- |
| 转录失败     | API Key 未配置     | 设置 ELEVENLABS_API_KEY             |
| 语音发送失败 | lxfile 路径无效    | 检查 send-voice.js 输出路径是否存在 |
| 空转录结果   | 音频静音或格式问题 | 检查音频文件                        |
| 语音质量差   | 默认参数不适合     | 调整 ELEVENLABS_VOICE_ID            |
