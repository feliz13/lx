/**
 * Feishu Voice Auto-Transcribe
 * 自动转录飞书语音消息的核心模块
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ElevenLabs API Key - must be set via ELEVENLABS_API_KEY env
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

/**
 * 日志函数
 */
function log(level, message, ...args) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [Voice Transcribe] [${level}]`, message, ...args);
}

/**
 * 转录音频文件
 */
async function transcribeAudio(audioPath, lang = "zh") {
  if (!ELEVENLABS_API_KEY) {
    throw new Error("ELEVENLABS_API_KEY environment variable is required for transcription");
  }
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  log("INFO", `Starting transcription: ${audioPath}`);

  try {
    const scriptPath = path.join(__dirname, "../scripts/transcribe.sh");

    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Transcribe script not found: ${scriptPath}`);
    }

    const result = execSync(`"${scriptPath}" "${audioPath}" --lang ${lang}`, {
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, ELEVENLABS_API_KEY },
    });

    const text = result.trim();
    log("INFO", `Transcription successful: "${text}"`);

    return text;
  } catch (error) {
    log("ERROR", `Transcription failed: ${error.message}`);
    throw error;
  }
}

/**
 * 检测语言（简单实现，基于字符集）
 */
function detectLanguage(text) {
  if (!text) return "zh";

  // 检查是否包含中文字符
  const hasChinese = /[\u4e00-\u9fa5]/.test(text);

  if (hasChinese) return "zh";
  return "en";
}

/**
 * 检查是否为语音消息
 */
function isVoiceMessage(message) {
  if (!message || typeof message !== "object") return false;

  // 检查媒体类型
  if (message.media && message.media.mimeType) {
    return message.media.mimeType.startsWith("audio/");
  }

  return false;
}

/**
 * 处理消息 - 主入口函数
 */
async function processMessage(message) {
  try {
    if (!isVoiceMessage(message)) {
      return message;
    }

    log("INFO", "Detected voice message");

    const audioPath = message.media?.path;
    if (!audioPath) {
      log("WARN", "Voice message without media path");
      return message;
    }

    // 等待文件下载完成（如果需要）
    let retries = 0;
    while (!fs.existsSync(audioPath) && retries < 10) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      retries++;
    }

    if (!fs.existsSync(audioPath)) {
      log("ERROR", `Audio file not downloaded: ${audioPath}`);
      return message;
    }

    // 转录
    const transcription = await transcribeAudio(audioPath, "zh");

    if (!transcription) {
      log("WARN", "Empty transcription result");
      return message;
    }

    log("INFO", `Transcription complete: "${transcription}"`);

    // 返回包含转录文本的新消息对象
    return {
      ...message,
      text: transcription,
      originalText: message.text || "",
      transcription,
      isTranscribed: true,
      metadata: {
        ...(message.metadata || {}),
        voiceTranscription: {
          text: transcription,
          timestamp: new Date().toISOString(),
          audioPath,
        },
      },
    };
  } catch (error) {
    log("ERROR", `Failed to process voice message: ${error.message}`);

    // 返回带有错误信息的消息
    return {
      ...message,
      text: `[语音消息转录失败: ${error.message}]`,
      transcriptionError: error.message,
    };
  }
}

/**
 * 初始化 Hook
 */
function init() {
  log("INFO", "Feishu Voice Auto-Transcribe initialized");
  log("INFO", `API Key configured: ${ELEVENLABS_API_KEY ? "YES" : "NO"}`);
}

module.exports = {
  init,
  processMessage,
  transcribeAudio,
  isVoiceMessage,
  detectLanguage,
};
