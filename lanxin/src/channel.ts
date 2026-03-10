import {
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  formatAllowFromLowercase,
  formatPairingApproveHint,
  missingTargetError,
  normalizeAccountId,
  PAIRING_APPROVED_MESSAGE,
  resolveChannelAccountConfigBasePath,
  setAccountEnabledInConfigSection,
  type ChannelDock,
  type ChannelPlugin,
  type OpenClawConfig,
} from "openclaw/plugin-sdk";
import {
  listLanxinAccountIds,
  resolveDefaultLanxinAccountId,
  resolveLanxinAccount,
} from "./accounts.js";
import { LanxinConfigSchema } from "./config-schema.js";
import { lanxinOnboardingAdapter } from "./onboarding.js";
import { sendMediaLanxin, sendMessageLanxin } from "./send.js";
import type { ResolvedLanxinAccount } from "./types.js";

const meta = {
  id: "lanxin",
  label: "蓝信",
  selectionLabel: "蓝信 (Lanxin)",
  docsPath: "/channels/lanxin",
  blurb: "蓝信开放平台智能机器人，支持私聊与群聊。",
  aliases: ["lanxin-bot"],
  order: 75,
  quickstartAllowFrom: true,
};

function formatAllowFromEntry(entry: string): string {
  return entry
    .trim()
    .replace(/^(lanxin|lanxin-bot):/i, "")
    .replace(/^group:/i, "")
    .replace(/^chat:/i, "")
    .toLowerCase();
}

export const lanxinDock: ChannelDock = {
  id: "lanxin",
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    blockStreaming: true,
  },
  outbound: { textChunkLimit: 4000 },
  config: {
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveLanxinAccount({ cfg, accountId }).config.allowFrom ?? []).map((e) => String(e)),
    formatAllowFrom: ({ allowFrom }) =>
      formatAllowFromLowercase({ allowFrom, stripPrefixRe: /^(lanxin|lanxin-bot|group|chat):/i }),
  },
  groups: {
    resolveRequireMention: () => true,
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
};

export const lanxinPlugin: ChannelPlugin<ResolvedLanxinAccount> = {
  id: "lanxin",
  meta,
  onboarding: lanxinOnboardingAdapter,
  pairing: {
    idLabel: "lanxinUserId",
    normalizeAllowEntry: (entry) => formatAllowFromEntry(entry),
    notifyApproval: async ({ cfg, id }) => {
      const account = resolveLanxinAccount({ cfg });
      await sendMessageLanxin(id.replace(/^group:/i, ""), PAIRING_APPROVED_MESSAGE, {
        cfg,
        accountId: account.accountId,
      });
    },
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  streaming: {
    blockStreamingCoalesceDefaults: { minChars: 300, idleMs: 1000 },
  },
  reload: { configPrefixes: ["channels.lanxin"] },
  configSchema: buildChannelConfigSchema(LanxinConfigSchema),
  config: {
    listAccountIds: (cfg) => listLanxinAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveLanxinAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultLanxinAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "lanxin",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "lanxin",
        accountId,
        clearBaseFields: [
          "appId",
          "appSecret",
          "gatewayUrl",
          "callbackKey",
          "callbackSignToken",
          "name",
        ],
      }),
    isConfigured: (account) =>
      Boolean(
        account.config.appId?.trim() &&
        account.config.appSecret?.trim() &&
        account.config.gatewayUrl?.trim() &&
        account.config.callbackKey?.trim() &&
        account.config.callbackSignToken?.trim(),
      ),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(
        account.config.appId?.trim() &&
        account.config.appSecret?.trim() &&
        account.config.gatewayUrl?.trim() &&
        account.config.callbackKey?.trim() &&
        account.config.callbackSignToken?.trim(),
      ),
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveLanxinAccount({ cfg, accountId }).config.allowFrom ?? []).map((e) => String(e)),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom.map((e) => formatAllowFromEntry(String(e))).filter(Boolean),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const basePath = resolveChannelAccountConfigBasePath({
        cfg,
        channelKey: "lanxin",
        accountId: resolvedAccountId,
      });
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        allowFromPath: basePath,
        approveHint: formatPairingApproveHint("lanxin"),
        normalizeEntry: (raw) => formatAllowFromEntry(raw),
      };
    },
  },
  groups: {
    resolveRequireMention: () => true,
  },
  messaging: {
    normalizeTarget: (raw) => {
      const t = raw?.trim();
      if (!t) return undefined;
      const stripped = t.replace(/^(lanxin|lanxin-bot):/i, "").trim();
      return stripped || undefined;
    },
    targetResolver: {
      looksLikeId: (raw, normalized) => {
        const v = normalized ?? raw?.trim() ?? "";
        return v.length > 0;
      },
      hint: "<userId> or group:<chatId>",
    },
  },
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 4000,
    resolveTarget: ({ to }) => {
      const t = to?.trim() ?? "";
      if (!t) {
        return { ok: false, error: missingTargetError("Lanxin", "<userId> or group:<chatId>") };
      }
      const normalized = t.replace(/^(lanxin|lanxin-bot):/i, "").trim();
      if (!normalized) {
        return { ok: false, error: missingTargetError("Lanxin", "<userId> or group:<chatId>") };
      }
      return { ok: true, to: t.startsWith("group:") || t.startsWith("chat:") ? t : normalized };
    },
    sendText: async ({ cfg, to, text, accountId }) => {
      const account = resolveLanxinAccount({ cfg, accountId });
      const result = await sendMessageLanxin(to, text, { cfg, accountId: account.accountId });
      if (!result.ok) {
        throw new Error(result.error ?? "send failed");
      }
      return {
        channel: "lanxin",
        messageId: result.messageId ?? "",
        chatId: to,
      };
    },
    sendMedia: async ({ cfg, to, text, mediaUrl, mediaLocalRoots, accountId }) => {
      if (!mediaUrl) throw new Error("mediaUrl required for sendMedia");
      const account = resolveLanxinAccount({ cfg, accountId });
      const result = await sendMediaLanxin(to, text, mediaUrl, {
        cfg,
        accountId: account.accountId,
        mediaLocalRoots,
      });
      if (!result.ok) {
        throw new Error(result.error ?? "send media failed");
      }
      return {
        channel: "lanxin",
        messageId: result.messageId ?? "",
        chatId: to,
      };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account }) => {
      try {
        const { getLanxinAppToken } = await import("./api.js");
        await getLanxinAppToken(account);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(
        account.config.appId?.trim() &&
        account.config.appSecret?.trim() &&
        account.config.gatewayUrl?.trim() &&
        account.config.callbackKey?.trim() &&
        account.config.callbackSignToken?.trim(),
      ),
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      ctx.log?.info(`[${account.accountId}] starting Lanxin webhook`);
      ctx.setStatus({
        accountId: account.accountId,
        running: true,
        lastStartAt: Date.now(),
        lastError: null,
      });
      const { monitorLanxinProvider } = await import("./monitor.js");
      const unregister = monitorLanxinProvider({
        account,
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        webhookPath: account.config.webhookPath,
        webhookUrl: account.config.webhookUrl,
        statusSink: (patch) => ctx.setStatus({ accountId: account.accountId, ...patch }),
      });
      // Return a Promise that stays pending until abort. If we returned the cleanup function,
      // the promise would resolve immediately and the gateway would treat it as "channel exited"
      // and trigger an infinite restart loop.
      return new Promise<void>((resolve) => {
        ctx.abortSignal.addEventListener(
          "abort",
          () => {
            unregister?.();
            ctx.setStatus({
              accountId: account.accountId,
              running: false,
              lastStopAt: Date.now(),
            });
            resolve();
          },
          { once: true },
        );
      });
    },
  },
};
