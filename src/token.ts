import type { BaseTokenResolution } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { getLanxinAppToken } from "./api.js";
import { resolveLanxinAccount } from "./accounts.js";

export function resolveLanxinToken(
  cfg: OpenClawConfig | undefined,
  accountId?: string | null,
): BaseTokenResolution {
  if (!cfg) {
    return { token: "", source: "none" };
  }
  const account = resolveLanxinAccount({ cfg, accountId });
  const hasCreds =
    Boolean(account.config.appId?.trim()) &&
    Boolean(account.config.appSecret?.trim()) &&
    Boolean(account.config.gatewayUrl?.trim());

  return {
    token: "",
    source: hasCreds ? "config" : "none",
  };
}

export async function getLanxinToken(
  cfg: OpenClawConfig,
  accountId?: string | null,
): Promise<string> {
  const account = resolveLanxinAccount({ cfg, accountId: accountId ?? DEFAULT_ACCOUNT_ID });
  return getLanxinAppToken(account);
}
