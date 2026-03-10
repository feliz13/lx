import type { ResolvedLanxinAccount } from "./types.js";

export type LanxinApiError = {
  ok: false;
  errCode?: number;
  errMsg?: string;
};

export type LanxinApiResult<T> = { ok: true; data: T } | LanxinApiError;

const APP_TOKEN_CACHE = new Map<string, { token: string; expiresAt: number }>();

function cacheKey(account: ResolvedLanxinAccount): string {
  return `${account.accountId}:${account.config.appId}`;
}

async function parseJsonOrThrow<T>(res: Response, context: string): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const preview = text.slice(0, 80).replace(/\s+/g, " ");
    if (/^<\s*html/i.test(text) || text.startsWith("<")) {
      throw new Error(
        `${context}: 收到 HTML 而非 JSON（状态 ${res.status}）。请检查 gatewayUrl 是否指向蓝信 API 网关，而非 OpenClaw 或其他非 API 地址。响应预览: ${preview}...`,
      );
    }
    throw new Error(`${context}: 无法解析 JSON - ${String(err)}`);
  }
}

export async function getLanxinAppToken(account: ResolvedLanxinAccount): Promise<string> {
  const gatewayUrl = account.config.gatewayUrl?.replace(/\/+$/, "");
  const appId = account.config.appId;
  const appSecret = account.config.appSecret;

  if (!gatewayUrl || !appId || !appSecret) {
    throw new Error("Lanxin: gatewayUrl, appId, appSecret are required");
  }

  const key = cacheKey(account);
  const cached = APP_TOKEN_CACHE.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const url = `${gatewayUrl}/v1/apptoken/create?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const res = await fetch(url);
  const json = await parseJsonOrThrow<{
    errCode?: number;
    errMsg?: string;
    data?: { appToken?: string; expiresIn?: number };
  }>(res, "蓝信 AppToken 接口");

  if (json.errCode !== 0 || !json.data?.appToken) {
    throw new Error(
      `Lanxin AppToken failed: ${json.errMsg ?? "unknown"} (errCode=${json.errCode ?? -1})`,
    );
  }

  const expiresIn = json.data.expiresIn ?? 7200;
  APP_TOKEN_CACHE.set(key, {
    token: json.data.appToken,
    expiresAt: Date.now() + expiresIn * 1000,
  });

  return json.data.appToken;
}

/** 蓝信媒体上传 type: VIDEO=1, IMAGE=2, AUDIO=3（文件类用 3） */
const LANXIN_MEDIA_TYPE_VIDEO = 1;
const LANXIN_MEDIA_TYPE_IMAGE = 2;
const LANXIN_MEDIA_TYPE_AUDIO = 3;

function lanxinMediaTypeFromMime(mime?: string | null): 1 | 2 | 3 {
  if (!mime) return LANXIN_MEDIA_TYPE_AUDIO; // file fallback
  if (mime.startsWith("image/")) return LANXIN_MEDIA_TYPE_IMAGE;
  if (mime.startsWith("video/")) return LANXIN_MEDIA_TYPE_VIDEO;
  if (mime.startsWith("audio/")) return LANXIN_MEDIA_TYPE_AUDIO;
  return LANXIN_MEDIA_TYPE_AUDIO; // document/other as file (type 3)
}

/**
 * 上传媒体文件，获取 mediaId
 * 文档: https://developer.lanxin.cn/official/article?article_id=646eda903d4e4adb7039c155
 * 限制: 文件大小不超过 2MB
 */
export async function uploadLanxinMedia(params: {
  account: ResolvedLanxinAccount;
  token: string;
  buffer: Buffer;
  mimeType?: string;
  /** 原始文件名，用于下载时显示，避免显示为 blob */
  fileName?: string;
}): Promise<LanxinApiResult<{ mediaId: string }>> {
  const { account, token, buffer, mimeType, fileName } = params;
  const gatewayUrl = account.config.gatewayUrl?.replace(/\/+$/, "");

  if (!gatewayUrl) {
    return { ok: false, errMsg: "gatewayUrl not configured" };
  }

  const type = lanxinMediaTypeFromMime(mimeType);
  const url = `${gatewayUrl}/v1/medias/create?type=${type}&app_token=${encodeURIComponent(token)}`;

  const form = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], {
    type: mimeType ?? "application/octet-stream",
  });
  form.append("media", blob, fileName ?? "file");

  const res = await fetch(url, {
    method: "POST",
    body: form,
  });

  const rawText = await res.text();
  let json: { errCode?: number; errMsg?: string; data?: { mediaId?: string } };
  try {
    json = JSON.parse(rawText) as typeof json;
  } catch {
    throw new Error(
      `蓝信 uploadMedia: 非 JSON 响应 status=${res.status} body=${rawText.slice(0, 150)}`,
    );
  }

  if (json.errCode === 0 && json.data?.mediaId) {
    return { ok: true, data: { mediaId: json.data.mediaId } };
  }
  return {
    ok: false,
    errCode: json.errCode,
    errMsg: `${json.errMsg ?? "unknown"} (errCode=${json.errCode ?? -1})`,
  };
}

/**
 * 根据 mediaId 下载媒体文件
 * 文档: https://developer.lanxin.cn/official/article?article_id=646eda9e3d4e4adb7039c156
 * 正常响应为二进制流，Content-Type 非 application/json
 */
export async function fetchLanxinMedia(params: {
  account: ResolvedLanxinAccount;
  token: string;
  mediaId: string;
}): Promise<
  | { ok: true; buffer: Buffer; contentType?: string; fileName?: string }
  | { ok: false; errMsg: string }
> {
  const { account, token, mediaId } = params;
  const gatewayUrl = account.config.gatewayUrl?.replace(/\/+$/, "");

  if (!gatewayUrl) {
    return { ok: false, errMsg: "gatewayUrl not configured" };
  }

  const url = `${gatewayUrl}/v1/medias/${encodeURIComponent(mediaId)}/fetch?app_token=${encodeURIComponent(token)}`;

  const res = await fetch(url);

  const contentType = res.headers.get("content-type") ?? undefined;
  const contentDisposition = res.headers.get("content-disposition") ?? "";

  if (!res.ok) {
    const text = await res.text();
    let errMsg = `HTTP ${res.status}`;
    try {
      const json = JSON.parse(text) as { errMsg?: string };
      if (json.errMsg) errMsg = json.errMsg;
    } catch {
      if (text) errMsg = text.slice(0, 200);
    }
    return { ok: false, errMsg };
  }

  const isJson = contentType?.includes("application/json");
  if (isJson) {
    const text = await res.text();
    let json: { errCode?: number; errMsg?: string };
    try {
      json = JSON.parse(text) as { errCode?: number; errMsg?: string };
    } catch {
      return { ok: false, errMsg: `unexpected JSON response: ${text.slice(0, 150)}` };
    }
    if (json.errCode !== 0) {
      return { ok: false, errMsg: json.errMsg ?? `errCode=${json.errCode ?? -1}` };
    }
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  let fileName: string | undefined;

  // RFC 5987: filename*=UTF-8'' 优先，保证中文等非 ASCII 正确解码
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;\s]+)/i);
  if (utf8Match) {
    try {
      fileName = decodeURIComponent(utf8Match[1].replace(/\+/g, " "));
    } catch {
      fileName = undefined;
    }
  }
  if (!fileName) {
    const filenameMatch = contentDisposition.match(/filename=(?:"([^"]*)"|([^;\s]+))/i);
    if (filenameMatch) {
      const raw = (filenameMatch[1] ?? filenameMatch[2])?.trim();
      if (raw) {
        // 修复 mojibake：服务端发 UTF-8 但被当作 Latin-1 解析时，还原正确中文
        fileName = Buffer.from(raw, "latin1").toString("utf8");
      }
    }
  }
  if (!fileName) {
    const m = contentType?.match(/\/(?:jpeg|jpg|png|gif|webp|pdf|plain|markdown|x-markdown)/i);
    const raw = m ? m[0].split("/")[1]?.replace("x-", "") : undefined;
    const extMap: Record<string, string> = {
      jpeg: "jpg", jpg: "jpg", png: "png", gif: "gif", webp: "webp",
      pdf: "pdf", plain: "txt", markdown: "md",
    };
    const mapped = raw ? extMap[raw.toLowerCase()] : undefined;
    const ext = mapped != null ? mapped : "bin";
    fileName = `${mediaId}.${ext}`;
  }

  return { ok: true, buffer, contentType, fileName };
}

/**
 * 智能机器人发送私聊消息
 * 文档: https://developer.lanxin.cn/official/article?article_id=646eda563d4e4adb7039c151
 * - 路径: /v1/bot/messages/create
 * - 鉴权: app_token 作为 query 参数
 * - 请求体: userIdList, msgType, msgData
 * - text 类型支持 mediaType(1=video,2=image,3=file) + mediaIds 实现文件消息
 */
export async function sendLanxinPrivateMessage(params: {
  account: ResolvedLanxinAccount;
  token: string;
  toUserId: string;
  msgType: string;
  content: string;
  /** mediaType: 1=video, 2=image, 3=file；与 mediaIds 同时提供时发送文件消息 */
  mediaType?: 1 | 2 | 3;
  mediaIds?: string[];
}): Promise<LanxinApiResult<unknown>> {
  const { account, token, toUserId, msgType, content, mediaType, mediaIds } = params;
  const gatewayUrl = account.config.gatewayUrl?.replace(/\/+$/, "");

  if (!gatewayUrl) {
    return { ok: false, errMsg: "gatewayUrl not configured" };
  }

  const path = account.config.sendPrivateMsgPath ?? "/v1/bot/messages/create";
  const base = `${gatewayUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  const url = `${base}${base.includes("?") ? "&" : "?"}app_token=${encodeURIComponent(token)}`;

  const hasMedia = mediaType != null && mediaIds != null && mediaIds.length > 0;
  const textPayload: Record<string, unknown> = { content: content.slice(0, 4000) };
  if (hasMedia) {
    textPayload.mediaType = mediaType;
    textPayload.mediaIds = mediaIds;
  }

  const userIdList = [toUserId];
  const body = {
    userIdList,
    msgType,
    msgData: { [msgType]: textPayload },
  };

  // 调试: 对比文本消息与文件/图片消息的 userIdList（errCode=50080 时排查用）
  console.warn(
    `[lanxin-debug] sendLanxinPrivateMessage: type=${hasMedia ? "media" : "text"} toUserId=${JSON.stringify(toUserId)} toUserIdType=${typeof toUserId} userIdList=${JSON.stringify(userIdList)}`,
  );
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const rawText = await res.text();
  let json: { errCode?: number; errMsg?: string };
  try {
    json = JSON.parse(rawText) as { errCode?: number; errMsg?: string };
  } catch {
    throw new Error(
      `蓝信 sendPrivateMsg: 非 JSON 响应 status=${res.status} url=${url.replace(token, "...")} body=${rawText.slice(0, 200)}`,
    );
  }
  if (json.errCode === 0) {
    return { ok: true, data: json };
  }
  const errMsg = `${json.errMsg ?? "unknown"} (errCode=${json.errCode ?? -1}, path=${path})`;
  return { ok: false, errCode: json.errCode, errMsg };
}

export async function sendLanxinGroupMessage(params: {
  account: ResolvedLanxinAccount;
  token: string;
  chatId: string;
  msgType: string;
  content: string;
  mediaType?: 1 | 2 | 3;
  mediaIds?: string[];
}): Promise<LanxinApiResult<unknown>> {
  const { account, token, chatId, msgType, content, mediaType, mediaIds } = params;
  const gatewayUrl = account.config.gatewayUrl?.replace(/\/+$/, "");

  if (!gatewayUrl) {
    return { ok: false, errMsg: "gatewayUrl not configured" };
  }

  const textPayload: Record<string, unknown> = { text: content.slice(0, 4000) };
  if (mediaType != null && mediaIds != null && mediaIds.length > 0) {
    textPayload.mediaType = mediaType;
    textPayload.mediaIds = mediaIds;
  }

  const path = account.config.sendGroupMsgPath ?? "/v1/bot/sendGroupMsg";
  const url = `${gatewayUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      chatId,
      msgType,
      content: textPayload,
    }),
  });

  const json = await parseJsonOrThrow<{ errCode?: number; errMsg?: string }>(
    res,
    "蓝信 sendGroupMsg",
  );
  if (json.errCode === 0) {
    return { ok: true, data: json };
  }
  return { ok: false, errCode: json.errCode, errMsg: json.errMsg };
}
