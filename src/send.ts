import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { loadWebMedia, resolveChannelMediaMaxBytes } from "openclaw/plugin-sdk";
import {
  getLanxinAppToken,
  sendLanxinGroupMessage,
  sendLanxinPrivateMessage,
  uploadLanxinMedia,
} from "./api.js";
import { resolveLanxinAccount } from "./accounts.js";

/** 蓝信媒体上传限制 2MB */
const LANXIN_MEDIA_MAX_BYTES = 2 * 1024 * 1024;

export type LanxinSendOptions = {
  cfg?: OpenClawConfig;
  accountId?: string;
};

export type LanxinSendResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};

function parseTarget(to: string): { isGroup: boolean; id: string } {
  const trimmed = to?.trim() ?? "";
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("group:") || lower.startsWith("chat:")) {
    return { isGroup: true, id: trimmed.slice(6).trim() };
  }
  return { isGroup: false, id: trimmed };
}

/** msgData.text mediaType: 1=video, 2=image, 3=file */
function msgMediaTypeFromKind(kind: "image" | "audio" | "video" | "document" | "unknown"): 1 | 2 | 3 {
  if (kind === "image") return 2;
  if (kind === "video") return 1;
  return 3; // audio, document, unknown → file
}

export async function sendMessageLanxin(
  to: string,
  text: string,
  options: LanxinSendOptions = {},
): Promise<LanxinSendResult> {
  if (!options.cfg) {
    return { ok: false, error: "config required" };
  }

  const account = resolveLanxinAccount({
    cfg: options.cfg,
    accountId: options.accountId,
  });

  if (!account.config.gatewayUrl || !account.config.appId || !account.config.appSecret) {
    return { ok: false, error: "Lanxin appId, appSecret, gatewayUrl are required" };
  }

  try {
    const token = await getLanxinAppToken(account);
    const { isGroup, id } = parseTarget(to);

    if (!id) {
      return { ok: false, error: "Empty target" };
    }

    if (isGroup) {
      const result = await sendLanxinGroupMessage({
        account,
        token,
        chatId: id,
        msgType: "text",
        content: text.slice(0, 4000),
      });
      if (!result.ok) {
        return { ok: false, error: result.errMsg ?? "send failed" };
      }
      return { ok: true, messageId: "" };
    }

    console.warn(`[lanxin-debug] sendMessageLanxin(私聊): to=${JSON.stringify(to)} parsed.id=${JSON.stringify(id)}`);
    const result = await sendLanxinPrivateMessage({
      account,
      token,
      toUserId: id,
      msgType: "text",
      content: text.slice(0, 4000),
    });
    if (!result.ok) {
      return { ok: false, error: result.errMsg ?? "send failed" };
    }
    return { ok: true, messageId: "" };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function sendMediaLanxin(
  to: string,
  text: string,
  mediaUrl: string,
  options: LanxinSendOptions & { mediaLocalRoots?: readonly string[] } = {},
): Promise<LanxinSendResult> {
  if (!options.cfg) {
    return { ok: false, error: "config required" };
  }

  const account = resolveLanxinAccount({
    cfg: options.cfg,
    accountId: options.accountId,
  });

  if (!account.config.gatewayUrl || !account.config.appId || !account.config.appSecret) {
    return { ok: false, error: "Lanxin appId, appSecret, gatewayUrl are required" };
  }

  const maxBytes =
    resolveChannelMediaMaxBytes({
      cfg: options.cfg,
      accountId: options.accountId,
      resolveChannelLimitMb: ({ cfg, accountId: aid }) =>
        cfg.channels?.lanxin?.accounts?.[aid ?? ""]?.mediaMaxMb ??
        cfg.channels?.lanxin?.mediaMaxMb,
    }) ?? LANXIN_MEDIA_MAX_BYTES;
  const clampedMax = Math.min(maxBytes, LANXIN_MEDIA_MAX_BYTES);

  const media = await loadWebMedia(mediaUrl, {
    maxBytes: clampedMax,
    localRoots: options.mediaLocalRoots,
  });

  const fileName =
    media.fileName ??
    (typeof mediaUrl === "string"
      ? mediaUrl.split("/").pop()?.split("?")[0]
      : undefined) ??
    "file";

  const upload = await uploadLanxinMedia({
    account,
    token: await getLanxinAppToken(account),
    buffer: media.buffer,
    mimeType: media.contentType,
    fileName,
  });

  if (!upload.ok) {
    return { ok: false, error: upload.errMsg ?? "媒体上传失败" };
  }

  const mediaType = msgMediaTypeFromKind(media.kind);
  const token = await getLanxinAppToken(account);
  const { isGroup, id } = parseTarget(to);

  if (!id) {
    return { ok: false, error: "Empty target" };
  }

  if (media.kind === "video") {
    return {
      ok: false,
      error:
        "蓝信视频需 mediaIds=[视频ID, 封面图ID]，当前仅支持单文件上传，暂不支持视频",
    };
  }

  try {
    if (isGroup) {
      const result = await sendLanxinGroupMessage({
        account,
        token,
        chatId: id,
        msgType: "text",
        content: text.slice(0, 4000),
        mediaType,
        mediaIds: [upload.data.mediaId],
      });
      if (!result.ok) {
        return { ok: false, error: result.errMsg ?? "send failed" };
      }
      return { ok: true, messageId: "" };
    }

    console.warn(
      `[lanxin-debug] sendMediaLanxin(私聊): to=${JSON.stringify(to)} parsed.id=${JSON.stringify(id)} mediaType=${mediaType}`,
    );
    const result = await sendLanxinPrivateMessage({
      account,
      token,
      toUserId: id,
      msgType: "text",
      content: text.slice(0, 4000),
      mediaType,
      mediaIds: [upload.data.mediaId],
    });
    if (!result.ok) {
      return { ok: false, error: result.errMsg ?? "send failed" };
    }
    return { ok: true, messageId: "" };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
