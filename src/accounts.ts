import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import type { LanxinAccountConfig, ResolvedLanxinAccount } from "./types.js";

function listConfiguredAccountIds(cfg: OpenClawConfig): string[] {
  const accounts = cfg.channels?.["lanxin"]?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return [];
  }
  return Object.keys(accounts).filter(Boolean);
}

export function listLanxinAccountIds(cfg: OpenClawConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return ids.toSorted((a, b) => a.localeCompare(b));
}

export function resolveDefaultLanxinAccountId(cfg: OpenClawConfig): string {
  const channel = cfg.channels?.["lanxin"];
  if (channel?.defaultAccount?.trim()) {
    return channel.defaultAccount.trim();
  }
  const ids = listLanxinAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): LanxinAccountConfig | undefined {
  const accounts = cfg.channels?.["lanxin"]?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }
  return accounts[accountId] as LanxinAccountConfig | undefined;
}

function mergeLanxinAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): LanxinAccountConfig {
  const raw = cfg.channels?.["lanxin"] ?? {};
  const { accounts: _ignored, defaultAccount: _ignored2, ...base } = raw as LanxinAccountConfig & {
    accounts?: unknown;
    defaultAccount?: string;
  };
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return { ...base, ...account } as LanxinAccountConfig;
}

export function resolveLanxinAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedLanxinAccount {
  const accountId = normalizeAccountId(params.accountId);
  const baseEnabled = params.cfg.channels?.["lanxin"]?.enabled !== false;
  const merged = mergeLanxinAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;

  return {
    accountId,
    name: merged.name?.trim() || undefined,
    enabled,
    config: merged,
  };
}
