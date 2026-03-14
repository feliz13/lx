import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  createReplyPrefixOptions,
  readJsonBodyWithLimit,
  registerWebhookTarget,
  rejectNonPostWebhookRequest,
  resolveWebhookPath,
  resolveWebhookTargets,
  requestBodyErrorToText,
  resolveMentionGatingWithBypass,
} from "openclaw/plugin-sdk";
import { resolveLanxinAccount } from "./accounts.js";
import { fetchLanxinMedia, fetchLanxinStaffName, getLanxinAppToken } from "./api.js";
import { decryptLanxinPayload, verifyLanxinSignature } from "./crypto.js";
import { parseLanxinMediaTags } from "./media-tags.js";
import { getLanxinRuntime } from "./runtime.js";
import { sendMediaLanxin, sendMessageLanxin } from "./send.js";
import type { LanxinCallbackEvent, ResolvedLanxinAccount } from "./types.js";

export type LanxinRuntimeEnv = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

export type LanxinMonitorOptions = {
  account: ResolvedLanxinAccount;
  config: OpenClawConfig;
  runtime: LanxinRuntimeEnv;
  abortSignal: AbortSignal;
  webhookPath?: string;
  webhookUrl?: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

type LanxinCoreRuntime = ReturnType<typeof getLanxinRuntime>;

type WebhookTarget = {
  account: ResolvedLanxinAccount;
  config: OpenClawConfig;
  runtime: LanxinRuntimeEnv;
  core: LanxinCoreRuntime;
  path: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

const webhookTargets = new Map<string, WebhookTarget[]>();
const recentEventIds = new Map<string, number>();
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

function logVerbose(core: LanxinCoreRuntime, runtime: LanxinRuntimeEnv, message: string) {
  if (core.logging.shouldLogVerbose()) {
    runtime.log?.(`[lanxin] ${message}`);
  }
}

export function registerLanxinWebhookTarget(target: WebhookTarget): () => void {
  return registerWebhookTarget(webhookTargets, target).unregister;
}

function isDuplicateEvent(eventId: string): boolean {
  const now = Date.now();
  const seen = recentEventIds.get(eventId);
  recentEventIds.set(eventId, now);
  if (seen && now - seen < DEDUPE_WINDOW_MS) {
    return true;
  }
  if (recentEventIds.size > 5000) {
    const cutoff = now - DEDUPE_WINDOW_MS;
    for (const [k, v] of recentEventIds.entries()) {
      if (v < cutoff) recentEventIds.delete(k);
    }
  }
  return false;
}

function logLanxin(targets: WebhookTarget[], message: string) {
  targets[0]?.runtime.log?.(`[lanxin] ${message}`);
}

export async function handleLanxinWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const resolved = resolveWebhookTargets(req, webhookTargets);
  if (!resolved) {
    return false;
  }
  const { targets } = resolved;

  const url = new URL(req.url ?? "/", "http://localhost");
  logLanxin(
    targets,
    `webhook ${req.method} ${url.pathname}${url.search ? `?${url.search.slice(0, 80)}` : ""}`,
  );

  if (rejectNonPostWebhookRequest(req, res)) {
    return true;
  }
  const timestamp = url.searchParams.get("timestamp") ?? "";
  const nonce = url.searchParams.get("nonce") ?? "";
  const signature =
    url.searchParams.get("dev_data_signature") ?? url.searchParams.get("signature") ?? "";

  const body = await readJsonBodyWithLimit(req, {
    maxBytes: 1024 * 1024,
    timeoutMs: 30_000,
    emptyObjectOnEmpty: false,
  });
  if (!body.ok) {
    logLanxin(targets, `body parse failed: ${body.code ?? "unknown"} - ${body.error ?? ""}`);
    res.statusCode =
      body.code === "PAYLOAD_TOO_LARGE" ? 413 : body.code === "REQUEST_BODY_TIMEOUT" ? 408 : 400;
    res.end(
      body.code === "REQUEST_BODY_TIMEOUT"
        ? requestBodyErrorToText("REQUEST_BODY_TIMEOUT")
        : body.error,
    );
    return true;
  }

  let dataEncrypt: string;
  const raw = body.value;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const enc =
      (raw as { encrypt?: string }).encrypt ??
      (raw as { dataEncrypt?: string }).dataEncrypt ??
      (raw as { Encrypt?: string }).Encrypt;
    dataEncrypt = typeof enc === "string" ? enc : "";
  } else if (typeof raw === "string") {
    dataEncrypt = raw;
  } else {
    dataEncrypt = "";
  }

  if (!dataEncrypt) {
    logLanxin(targets, "no encrypt/dataEncrypt in payload, returning 200");
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end("{}");
    return true;
  }

  let matchedTarget: WebhookTarget | null = null;
  for (const target of targets) {
    const key = target.account.config.callbackKey?.trim();
    const token = target.account.config.callbackSignToken?.trim();
    if (!key || !token) continue;
    if (
      signature &&
      !verifyLanxinSignature({
        signToken: token,
        timestamp,
        nonce,
        dataEncrypt,
        expectedSignature: signature,
      })
    ) {
      continue;
    }
    matchedTarget = target;
    break;
  }

  if (!matchedTarget) {
    logLanxin(
      targets,
      "no matching target (signature verify failed or missing callbackKey/token), 401",
    );
    res.statusCode = 401;
    res.end("unauthorized");
    return true;
  }

  let decrypted: string;
  try {
    decrypted = decryptLanxinPayload({
      dataEncrypt,
      aesKey: matchedTarget.account.config.callbackKey!,
    });
  } catch (err) {
    matchedTarget.runtime.error?.(`[lanxin] decrypt failed: ${String(err)}`);
    res.statusCode = 400;
    res.end("decrypt failed");
    return true;
  }

  let events: LanxinCallbackEvent[];
  try {
    const parsed = JSON.parse(decrypted) as {
      events?: LanxinCallbackEvent[];
    } & LanxinCallbackEvent;
    events = Array.isArray(parsed.events) ? parsed.events : [parsed];
  } catch (err) {
    matchedTarget.runtime.error?.(`[lanxin] decrypt JSON parse failed: ${String(err)}`);
    res.statusCode = 200;
    res.end("{}");
    return true;
  }

  matchedTarget.runtime.log?.(`[lanxin] received ${events.length} event(s)`);
  matchedTarget.statusSink?.({ lastInboundAt: Date.now() });

  for (const evt of events) {
    const eventId = String(
      evt.id ?? evt.eventId ?? evt.eventType ?? `${Date.now()}-${Math.random()}`,
    );
    if (isDuplicateEvent(eventId)) {
      matchedTarget.runtime.log?.(`[lanxin] skip duplicate event id=${eventId}`);
      continue;
    }
    processLanxinEvent(evt, matchedTarget).catch((err) => {
      matchedTarget!.runtime.error?.(`[lanxin] event processing failed: ${String(err)}`);
    });
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end("{}");
  return true;
}

function extractMediaIds(evt: LanxinCallbackEvent): string[] {
  const data = evt.data as Record<string, unknown> | undefined;
  const msgType = (data?.msgType ?? evt.eventType ?? evt.msgType ?? "").toString().toLowerCase();
  if (msgType !== "file" && msgType !== "image" && msgType !== "voice") return [];
  const msgData = data?.msgData as Record<string, unknown> | undefined;
  const mediaData = (
    msgType === "file" ? msgData?.file : msgType === "image" ? msgData?.image : msgData?.voice
  ) as Record<string, unknown> | undefined;
  const ids = mediaData?.mediaIds;
  if (Array.isArray(ids)) {
    return ids.filter((id): id is string => typeof id === "string" && id.length > 0);
  }
  return [];
}

function extractMessageContent(evt: LanxinCallbackEvent): string {
  // 1. bot_private_message 等: data.msgData.text.content 或 .Content
  const data = evt.data as Record<string, unknown> | undefined;
  if (data?.msgData && typeof data.msgData === "object") {
    const md = (data.msgData as Record<string, unknown>).text;
    if (md && typeof md === "object") {
      const t = md as Record<string, unknown>;
      const s = (t.content ?? t.Content) as string | undefined;
      if (typeof s === "string") return s;
    }
  }
  // 2. 兼容 content 直接为字符串或 { text, body, ... }
  const content = evt.content;
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    const c = content as Record<string, unknown>;
    const text =
      (typeof c.text === "string" ? c.text : null) ??
      (typeof c.body === "string" ? c.body : null) ??
      (typeof c.content === "string" ? c.content : null) ??
      (typeof c.msg === "string" ? c.msg : null) ??
      (c.msgList && Array.isArray(c.msgList)
        ? (c.msgList as Array<{ text?: string; body?: string }>)
            .map((m) => m.text ?? m.body ?? "")
            .filter(Boolean)
            .join("\n")
        : null);
    if (text) return text;
  }
  return "";
}

function isSenderAllowed(senderId: string, allowFrom: string[]): boolean {
  if (allowFrom.includes("*")) return true;
  const n = senderId.toLowerCase();
  return allowFrom.some(
    (e) =>
      String(e)
        .toLowerCase()
        .replace(/^(lanxin|lanxin-bot):/i, "") === n,
  );
}

async function processLanxinEvent(evt: LanxinCallbackEvent, target: WebhookTarget): Promise<void> {
  const eventType = evt.eventType ?? evt.msgType ?? "";
  const { account, config, runtime, core } = target;
  const data = evt.data as Record<string, unknown> | undefined;
  
  // Handle bot_group_message and bot_private_message events
  const isBotGroupMessage = eventType === "bot_group_message";
  const isBotPrivateMessage = eventType === "bot_private_message";
  
  // For bot events, extract from the event data directly
  const senderId = String(
    data?.from ?? evt.fromUserId ?? evt.from ?? data?.FromStaffId ?? "",
  ).trim();
  // For bot_group_message, use groupId as chatId
  const chatId = String(
    data?.groupId ?? evt.groupId ?? evt.chatId ?? evt.toUserId ?? evt.to ?? "",
  ).trim();
  const entryId = String(data?.entryId ?? evt.entryId ?? "").trim();
  
  const isGroup = Boolean(evt.groupId || data?.groupId || evt.chatId) || /^group|chat/i.test(chatId);
  const rawBody = extractMessageContent(evt);

  if (!/message|msg|text|file|image|voice/i.test(eventType) && !evt.content) {
    logVerbose(core, runtime, `skip event type=${eventType}`);
    return;
  }

  let bodyForAgent = rawBody;

  if (!rawBody?.trim()) {
    const mediaIds = extractMediaIds(evt);
    if (mediaIds.length > 0) {
      runtime.log?.(`[lanxin] inbound file/image/voice message, mediaIds=${mediaIds.length}`);
      const token = await getLanxinAppToken(account);
      const inboundDir = path.join(tmpdir(), "openclaw-lanxin-inbound");
      await fs.mkdir(inboundDir, { recursive: true });
      const savedPaths: string[] = [];

      for (const mediaId of mediaIds) {
        const result = await fetchLanxinMedia({ account, token, mediaId });
        if (!result.ok) {
          runtime.error?.(`[lanxin] fetch media ${mediaId} failed: ${result.errMsg}`);
          continue;
        }
        const originalName = result.fileName ?? `${mediaId}.bin`;
        const savePath = path.join(inboundDir, path.basename(originalName));
        await fs.writeFile(savePath, result.buffer);
        savedPaths.push(savePath);
        runtime.log?.(`[lanxin] downloaded media ${mediaId} -> ${savePath}`);
      }

      // BodyForAgent 仅包含绝对路径与文件类型，供 Agent 用 read_file 等工具读取（文件与图片统一处理）
      if (savedPaths.length > 0) {
        const extToType: Record<string, string> = {
          md: "Markdown",
          txt: "文本",
          pdf: "PDF",
          jpg: "图片",
          jpeg: "图片",
          png: "图片",
          gif: "图片",
          webp: "图片",
          xlsx: "Excel",
          docx: "Word",
          ogg: "语音",
          opus: "语音",
          mp3: "语音",
          m4a: "语音",
          wav: "语音",
          amr: "语音",
        };
        const pathTypeLines = savedPaths
          .map((p) => {
            const ext = path.extname(p).slice(1).toLowerCase();
            const type = (extToType[ext] ?? ext) || "文件";
            return `${p} （${type}）`;
          })
          .join("\n");
        const msgType = (data?.msgType as string)?.toString().toLowerCase();
        const hasVoice = msgType === "voice" || pathTypeLines.includes("（语音）");
        if (hasVoice) {
          bodyForAgent = `【语音消息】用户发送了语音，请先转录音频理解内容，并用语音回复（参考 lanxin-stt-tts 技能：transcribe.sh 转录，send-voice.js 生成后用 <lxfile> 发送）。\n\n${pathTypeLines}`;
        } else {
          bodyForAgent = `用户上传文件/图片，仅回复路径与类型：\n${pathTypeLines}`;
        }
      }
    }
  }

  if (!bodyForAgent?.trim()) {
    const evtPreview = JSON.stringify(evt).slice(0, 500);
    runtime.log?.(
      `[lanxin] skip empty body, raw event preview: ${evtPreview}${JSON.stringify(evt).length > 500 ? "..." : ""}`,
    );
    return;
  }

  const rawBodyFinal = bodyForAgent;
  runtime.log?.(
    `[lanxin] inbound eventType=${eventType} from=${senderId || "?"} to=${chatId || "?"} isGroup=${isGroup} body=${(rawBodyFinal ?? "").slice(0, 80)}${(rawBodyFinal ?? "").length > 80 ? "..." : ""}`,
  );

  const configAllowFrom = (account.config.allowFrom ?? []).map(String);
  const dmPolicy = account.config.dmPolicy ?? "pairing";
  const storeAllowFrom =
    !isGroup && dmPolicy !== "open"
      ? await core.channel.pairing.readAllowFromStore("lanxin").catch(() => [])
      : [];
  const effectiveAllowFrom = [...configAllowFrom, ...storeAllowFrom];
  const commandAllowFrom = isGroup
    ? (account.config.groupAllowFrom ?? account.config.groups?.[chatId]?.users ?? []).map(String)
    : effectiveAllowFrom;
  const senderAllowedForCommands = isSenderAllowed(senderId, commandAllowFrom);
  const shouldComputeAuth = core.channel.commands.shouldComputeCommandAuthorized(
    rawBodyFinal,
    config,
  );
  const commandAuthorized = shouldComputeAuth
    ? core.channel.commands.resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups: config.commands?.useAccessGroups !== false,
        authorizers: [
          { configured: commandAllowFrom.length > 0, allowed: senderAllowedForCommands },
        ],
      })
    : undefined;

  const groupPolicy = account.config.groupPolicy ?? "allowlist";
  if (isGroup) {
    if (groupPolicy === "disabled") {
      logVerbose(core, runtime, `skip group msg (groupPolicy=disabled)`);
      return;
    }
    const groups = account.config.groups ?? {};
    const entry = groups[chatId] ?? groups["*"];
    if (groupPolicy === "allowlist" && !entry) {
      logVerbose(core, runtime, `skip group msg (allowlist, no entry for ${chatId})`);
      return;
    }
    if (entry?.enabled === false || entry?.allow === false) {
      logVerbose(core, runtime, `skip group msg (entry disabled)`);
      return;
    }
    const requireMention = entry?.requireMention ?? account.config.requireMention ?? true;
    const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
      cfg: config,
      surface: "lanxin",
    });
    const mentionGate = resolveMentionGatingWithBypass({
      isGroup: true,
      requireMention,
      canDetectMention: false,
      wasMentioned: false,
      implicitMention: false,
      hasAnyMention: false,
      allowTextCommands,
      hasControlCommand: core.channel.text.hasControlCommand(rawBodyFinal, config),
      commandAuthorized: commandAuthorized === true,
    });
    if (mentionGate.shouldSkip) {
      logVerbose(core, runtime, `skip group msg (mention gate)`);
      return;
    }
  }

  if (!isGroup) {
    if (dmPolicy === "disabled") {
      logVerbose(core, runtime, `skip dm (dmPolicy=disabled)`);
      return;
    }
    if (dmPolicy !== "open") {
      const allowed = senderAllowedForCommands;
      if (!allowed) {
        runtime.log?.(
          `[lanxin] dm not allowed: dmPolicy=${dmPolicy} allowFrom=${JSON.stringify(effectiveAllowFrom)} sender=${senderId}`,
        );
        if (dmPolicy === "pairing") {
          const { code, created } = await core.channel.pairing.upsertPairingRequest({
            channel: "lanxin",
            id: senderId,
            meta: {},
          });
          if (created) {
            runtime.log?.(`[lanxin] pairing request from ${senderId}, sent code`);
            await sendMessageLanxin(
              senderId,
              core.channel.pairing.buildPairingReply({
                channel: "lanxin",
                idLine: `蓝信用户ID: ${senderId}`,
                code,
              }),
              { cfg: config, accountId: account.accountId },
            );
          } else {
            logVerbose(core, runtime, `skip dm (not in allowFrom, pairing pending)`);
          }
        } else {
          logVerbose(core, runtime, `skip dm (not in allowFrom)`);
        }
        return;
      }
    }
  }

  if (
    isGroup &&
    core.channel.commands.isControlCommandMessage(rawBodyFinal, config) &&
    commandAuthorized !== true
  ) {
    logVerbose(core, runtime, `skip control command (unauthorized)`);
    return;
  }

  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "lanxin",
    accountId: account.accountId,
    peer: { kind: isGroup ? "group" : "direct", id: chatId || senderId },
  });

  runtime.log?.(`[lanxin] dispatching to agent sessionKey=${route.sessionKey}`);
  const spaceId = isGroup ? chatId : senderId;
  const fromLabel = isGroup ? `group:${chatId}` : `user:${senderId}`;
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "Lanxin",
    from: fromLabel,
    timestamp: evt.timestamp ? evt.timestamp * 1000 : undefined,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBodyFinal,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: rawBodyFinal,
    RawBody: rawBodyFinal,
    CommandBody: rawBodyFinal,
    From: `lanxin:${senderId}`,
    To: `lanxin:${spaceId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "channel" : "direct",
    ConversationLabel: fromLabel,
    SenderId: senderId,
    Provider: "lanxin",
    Surface: "lanxin",
    MessageSid: String(evt.id ?? evt.eventId ?? ""),
    OriginatingChannel: "lanxin",
    OriginatingTo: `lanxin:${spaceId}`,
  });

  void core.channel.session
    .recordSessionMetaFromInbound({ storePath, sessionKey: route.sessionKey, ctx: ctxPayload })
    .catch((e) => runtime.error?.(`lanxin: session meta: ${String(e)}`));

  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg: config,
    agentId: route.agentId,
    channel: "lanxin",
    accountId: route.accountId,
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      ...prefixOptions,
      deliver: async (payload) => {
        let text = payload.text ?? "";
        const to = isGroup ? `group:${spaceId}` : spaceId;
        if (!text.trim()) {
          logVerbose(core, runtime, `deliver skip empty text`);
          return;
        }

        if (isGroup && senderId) {
          const senderName = await fetchLanxinStaffName({ account, openId: senderId });
          if (senderName) {
            text = `@${senderName} ${text}`;
          }
        }

        const queue = parseLanxinMediaTags(text);
        if (queue && queue.length > 0) {
          runtime.log?.(
            `[lanxin] detected ${queue.filter((q) => q.type !== "text").length} media tag(s), sending queue`,
          );
          const sendOpts = { cfg: config, accountId: account.accountId };
          for (const item of queue) {
            if (item.type === "text") {
              const result = await sendMessageLanxin(to, item.content, sendOpts);
              if (!result.ok) {
                runtime.error?.(`[lanxin] send text failed: ${result.error ?? "unknown"}`);
              }
            } else if (item.type === "image" || item.type === "file") {
              const mediaPath = item.path;
              runtime.log?.(
                `[lanxin] sending ${item.type} via tag: ${mediaPath.slice(0, 60)}${mediaPath.length > 60 ? "..." : ""}`,
              );
              const result = await sendMediaLanxin(to, "", mediaPath, sendOpts);
              if (result.ok) {
                runtime.log?.(`[lanxin] sent ${item.type} ok`);
              } else {
                runtime.error?.(`[lanxin] send ${item.type} failed: ${result.error ?? "unknown"}`);
              }
            }
          }
          target.statusSink?.({ lastOutboundAt: Date.now() });
          return;
        }

        runtime.log?.(
          `[lanxin] outbound to=${to} len=${text.length} preview=${text.slice(0, 60)}${text.length > 60 ? "..." : ""}`,
        );
        const result = await sendMessageLanxin(to, text, {
          cfg: config,
          accountId: account.accountId,
        });
        if (result.ok) {
          runtime.log?.(`[lanxin] send ok`);
        } else {
          runtime.error?.(`[lanxin] send failed: ${result.error ?? "unknown"}`);
        }
        target.statusSink?.({ lastOutboundAt: Date.now() });
      },
      onError: (err, info) => {
        runtime.error?.(`[${account.accountId}] Lanxin ${info.kind} reply failed: ${String(err)}`);
      },
    },
    replyOptions: { onModelSelected, disableBlockStreaming: false },
  });
}

export function monitorLanxinProvider(options: LanxinMonitorOptions): () => void {
  const core = getLanxinRuntime();
  const webhookPath = resolveWebhookPath({
    webhookPath: options.webhookPath,
    webhookUrl: options.webhookUrl,
    defaultPath: "/api/channels/lanxin/webhook",
  });
  console.log(`[${options.account.accountId}] RESOLVED webhookPath: ${webhookPath} (webhookPath=${options.webhookPath}, webhookUrl=${options.webhookUrl})`);
  options.runtime.log?.(`[${options.account.accountId}] RESOLVED webhookPath: ${webhookPath} (from webhookPath=${options.webhookPath}, webhookUrl=${options.webhookUrl})`);
  if (!webhookPath) {
    options.runtime.error?.(`[${options.account.accountId}] invalid webhook path`);
    return () => {};
  }

  const unregister = registerLanxinWebhookTarget({
    account: options.account,
    config: options.config,
    runtime: options.runtime,
    core,
    path: webhookPath,
    statusSink: options.statusSink,
  });

  return unregister;
}

export function resolveLanxinWebhookPath(params: { account: ResolvedLanxinAccount }): string {
  return (
    resolveWebhookPath({
      webhookPath: params.account.config.webhookPath,
      webhookUrl: params.account.config.webhookUrl,
      defaultPath: "/api/channels/lanxin/webhook",
    }) ?? "/api/channels/lanxin/webhook"
  );
}
