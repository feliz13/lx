import type { ChannelOnboardingAdapter, WizardPrompter } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, formatDocsLink, promptAccountId } from "openclaw/plugin-sdk";
import {
  listLanxinAccountIds,
  resolveDefaultLanxinAccountId,
  resolveLanxinAccount,
} from "./accounts.js";

const channel = "lanxin" as const;

function isLanxinConfigured(cfg: Parameters<typeof resolveLanxinAccount>[0]["cfg"]): boolean {
  const account = resolveLanxinAccount({ cfg });
  return (
    Boolean(account.config.appId?.trim()) &&
    Boolean(account.config.appSecret?.trim()) &&
    Boolean(account.config.gatewayUrl?.trim()) &&
    Boolean(account.config.callbackKey?.trim()) &&
    Boolean(account.config.callbackSignToken?.trim())
  );
}

function applyLanxinConfig(
  cfg: Parameters<typeof resolveLanxinAccount>[0]["cfg"],
  accountId: string,
  patch: Record<string, unknown>,
): Parameters<typeof resolveLanxinAccount>[0]["cfg"] {
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        lanxin: {
          ...cfg.channels?.["lanxin"],
          enabled: true,
          ...patch,
        },
      },
    };
  }
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      lanxin: {
        ...cfg.channels?.["lanxin"],
        enabled: true,
        accounts: {
          ...cfg.channels?.["lanxin"]?.accounts,
          [accountId]: {
            ...cfg.channels?.["lanxin"]?.accounts?.[accountId],
            enabled: true,
            ...patch,
          },
        },
      },
    },
  };
}

async function noteLanxinSetupHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "1) 登录蓝信开放平台，创建应用并获取 AppId、AppSecret",
      "2) 配置回调地址（如 https://your-domain/lxappbot）",
      "3) 获取回调密钥 callbackKey 和回调签名令牌 callbackSignToken",
      "4) 网关地址 gatewayUrl 一般为 https://openapi.lanxin.cn",
      `文档: ${formatDocsLink("/channels/lanxin", "channels/lanxin")}`,
    ].join("\n"),
    "蓝信配置说明",
  );
}

export const lanxinOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const configured = isLanxinConfigured(cfg);
    return {
      channel,
      configured,
      statusLines: [`蓝信: ${configured ? "已配置" : "需配置 AppId、AppSecret、gatewayUrl、callbackKey、callbackSignToken"}`],
      selectionHint: configured ? "已配置" : "需配置",
      quickstartScore: configured ? 2 : 0,
    };
  },
  configure: async ({ cfg, prompter, accountOverrides, shouldPromptAccountIds }) => {
    const override = accountOverrides["lanxin"]?.trim();
    const defaultAccountId = resolveDefaultLanxinAccountId(cfg);
    let accountId = override ? override : defaultAccountId;
    if (shouldPromptAccountIds && !override) {
      accountId = await promptAccountId({
        cfg,
        prompter,
        label: "蓝信",
        currentId: accountId,
        listAccountIds: listLanxinAccountIds,
        defaultAccountId,
      });
    }

    let next = cfg;
    await noteLanxinSetupHelp(prompter);

    const existing = resolveLanxinAccount({ cfg, accountId }).config;
    const hasExisting =
      existing.appId?.trim() &&
      existing.appSecret?.trim() &&
      existing.gatewayUrl?.trim() &&
      existing.callbackKey?.trim() &&
      existing.callbackSignToken?.trim();

    let appId: string;
    let appSecret: string;
    let gatewayUrl: string;
    let callbackKey: string;
    let callbackSignToken: string;
    let passportUrl: string | undefined;
    let webhookUrl: string | undefined;

    if (hasExisting) {
      const keep = await prompter.confirm({
        message: "蓝信凭证已配置，是否保留？",
        initialValue: true,
      });
      if (keep) {
        return { cfg: { ...cfg, channels: { ...cfg.channels, lanxin: { ...cfg.channels?.lanxin, enabled: true } } }, accountId };
      }
    }

    appId = String(
      await prompter.text({
        message: "AppId",
        initialValue: existing.appId?.trim(),
        validate: (v) => (String(v ?? "").trim() ? undefined : "必填"),
      }),
    ).trim();
    appSecret = String(
      await prompter.text({
        message: "AppSecret",
        initialValue: existing.appSecret?.trim(),
        validate: (v) => (String(v ?? "").trim() ? undefined : "必填"),
      }),
    ).trim();
    gatewayUrl = String(
      await prompter.text({
        message: "网关地址 gatewayUrl（蓝信 API 网关，可配置）",
        initialValue: existing.gatewayUrl?.trim(),
        placeholder: "https://openapi.lanxin.cn",
        validate: (v) => (String(v ?? "").trim() ? undefined : "必填"),
      }),
    ).trim();
    callbackKey = String(
      await prompter.text({
        message: "回调密钥 callbackKey",
        initialValue: existing.callbackKey?.trim(),
        validate: (v) => (String(v ?? "").trim() ? undefined : "必填"),
      }),
    ).trim();
    callbackSignToken = String(
      await prompter.text({
        message: "回调签名令牌 callbackSignToken",
        initialValue: existing.callbackSignToken?.trim(),
        validate: (v) => (String(v ?? "").trim() ? undefined : "必填"),
      }),
    ).trim();

    const needPassport = await prompter.confirm({
      message: "是否配置 passportUrl（授权页地址）？",
      initialValue: Boolean(existing.passportUrl?.trim()),
    });
    if (needPassport) {
      passportUrl = String(
        await prompter.text({
          message: "passportUrl",
          initialValue: existing.passportUrl?.trim(),
          validate: (v) => (String(v ?? "").trim() ? undefined : "必填"),
        }),
      ).trim() || undefined;
    }

    const needWebhook = await prompter.confirm({
      message: "是否配置 webhookUrl（完整回调地址）？",
      initialValue: Boolean(existing.webhookUrl?.trim()),
    });
    if (needWebhook) {
      webhookUrl = String(
        await prompter.text({
          message: "webhookUrl（如 https://openclaw.example.com/lxappbot）",
          initialValue: existing.webhookUrl?.trim(),
          validate: (v) => (String(v ?? "").trim() ? undefined : "必填"),
        }),
      ).trim() || undefined;
    }

    next = applyLanxinConfig(next, accountId, {
      appId,
      appSecret,
      gatewayUrl,
      callbackKey,
      callbackSignToken,
      ...(passportUrl ? { passportUrl } : {}),
      ...(webhookUrl ? { webhookUrl } : {}),
    });

    return { cfg: next, accountId };
  },
  disable: (cfg) => ({
    ...cfg,
    channels: {
      ...cfg.channels,
      lanxin: { ...cfg.channels?.lanxin, enabled: false },
    },
  }),
};
