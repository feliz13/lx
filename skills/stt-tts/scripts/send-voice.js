#!/usr/bin/env node

/**
 * 蓝信语音回复 TTS 工具
 * 使用 ElevenLabs TTS 生成 MP3，输出路径供 AI 通过 <lxfile> 标签发送
 *
 * 用法：
 *   node send-voice.js "文本内容"
 *
 * 输出：生成文件路径到 stdout，AI 用 <lxfile>路径</lxfile> 发送
 *
 * 环境变量：
 *   ELEVENLABS_API_KEY   必需
 *   ELEVENLABS_VOICE_ID  可选，默认 bhJUNIXWQQ94l8eI2VUf
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "bhJUNIXWQQ94l8eI2VUf";
const MODEL_ID = "eleven_v3";

const TTS_PARAMS = {
  stability: 0.0,
  similarity_boost: 0.5,
  style: 0.6,
  use_speaker_boost: true,
};

async function generateVoice(text) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error("ELEVENLABS_API_KEY environment variable is required");
  }

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: TTS_PARAMS,
    });

    const output = path.join(os.tmpdir(), `voice-${Date.now()}.mp3`);

    const options = {
      hostname: "api.elevenlabs.io",
      path: `/v1/text-to-speech/${VOICE_ID}`,
      method: "POST",
      headers: {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY,
      },
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let errorData = "";
        res.on("data", (chunk) => (errorData += chunk));
        res.on("end", () => {
          reject(new Error(`ElevenLabs API error: ${res.statusCode} - ${errorData}`));
        });
        return;
      }

      const file = fs.createWriteStream(output);
      res.pipe(file);

      file.on("finish", () => {
        file.close();
        resolve(output);
      });

      file.on("error", reject);
    });

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const text = process.argv[2];

  if (!text) {
    console.error('用法: node send-voice.js "文本内容"');
    console.error('示例: node send-voice.js "你好，这是语音回复"');
    process.exit(1);
  }

  try {
    const audioPath = await generateVoice(text);
    // Output path to stdout for AI to use with <lxfile> path </lxfile>
    console.log(audioPath);
  } catch (error) {
    console.error(`失败: ${error.message}`);
    process.exit(1);
  }
}

main();
