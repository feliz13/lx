import { createHash } from "node:crypto";
import { createDecipheriv } from "node:crypto";

/**
 * Verify Lanxin callback signature.
 * signature = sha1(sort(token, timestamp, nonce, dataEncrypt))
 */
export function verifyLanxinSignature(params: {
  signToken: string;
  timestamp: string;
  nonce: string;
  dataEncrypt: string;
  expectedSignature: string;
}): boolean {
  const { signToken, timestamp, nonce, dataEncrypt, expectedSignature } = params;
  const paramsArr = [signToken, timestamp, nonce, dataEncrypt].sort();
  const concat = paramsArr.join("");
  const hash = createHash("sha1").update(concat).digest("hex");
  return hash === expectedSignature.toLowerCase();
}

/**
 * Decrypt Lanxin callback payload.
 * 官方格式: dataEncrypt = Base64(AES[random(16B) + eventsLen(4B) + orgId + appId + events])
 * 参考: https://developer.lanxin.cn/official/article?article_id=646edbad3d4e4adb7039c163
 *
 * - dataEncrypt: Base64 密文
 * - aesKey: Base64 32 字节密钥（补 "=" 后解码）
 * - 算法: AES-256-CBC, IV = key 前 16 字节
 * - 解密后: 前 20 字节为头部，余下为 orgId + appId + events(JSON)
 * - events 为 JSON，从前 20 字节之后第一个 '{' 起截取到末尾
 */
export function decryptLanxinPayload(params: {
  dataEncrypt: string;
  aesKey: string;
}): string {
  const { dataEncrypt, aesKey } = params;

  const ciphertext = Buffer.from(dataEncrypt, "base64");
  if (ciphertext.length < 16) {
    throw new Error("Lanxin: ciphertext too short");
  }

  const keyBuffer = Buffer.from(aesKey + "=", "base64");
  if (keyBuffer.length < 32) {
    throw new Error("Lanxin: invalid aes key length");
  }

  const key = keyBuffer.subarray(0, 32);
  const iv = key.subarray(0, 16);

  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(true);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  if (decrypted.length < 21) {
    throw new Error("Lanxin: decrypted payload too short");
  }

  // 按官方格式: random(16B) + eventsLen(4B) + orgId + appId + events
  // 官方示例仅返回完整明文，不解析结构；解密后可能含 events 后的 appId 等尾缀
  // 提取第一个完整的 JSON 对象（括号匹配），避免尾缀导致 JSON.parse 失败
  const rest = decrypted.subarray(20).toString("utf-8");
  const jsonStart = rest.indexOf("{");
  if (jsonStart === -1) {
    throw new Error("Lanxin: no JSON object found in decrypted payload");
  }
  const extracted = extractFirstJsonObject(rest.slice(jsonStart));
  if (!extracted) {
    throw new Error("Lanxin: invalid JSON structure in decrypted payload");
  }
  return extracted;
}

/** 提取字符串中第一个完整的 JSON 对象（支持嵌套），用于过滤尾缀 */
function extractFirstJsonObject(str: string): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  let quote = "";
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") escape = true;
      else if (c === quote) inString = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      quote = c;
      continue;
    }
    if (c === "{") {
      depth++;
      continue;
    }
    if (c === "}") {
      depth--;
      if (depth === 0) return str.slice(0, i + 1);
    }
  }
  return null;
}
