import type { OpenClawConfig } from "openclaw/plugin-sdk";

export type LanxinAccountConfig = {
  name?: string;
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  gatewayUrl?: string;
  passportUrl?: string;
  callbackKey?: string;
  callbackSignToken?: string;
  webhookPath?: string;
  webhookUrl?: string;
  allowFrom?: Array<string | number>;
  dmPolicy?: "open" | "pairing" | "allowlist" | "disabled";
  groupPolicy?: "open" | "allowlist" | "disabled";
  groupAllowFrom?: Array<string | number>;
  groups?: Record<
    string,
    {
      requireMention?: boolean;
      enabled?: boolean;
      allow?: boolean;
      users?: Array<string | number>;
    }
  >;
  requireMention?: boolean;
  mediaMaxMb?: number;
  /** 发送私聊消息 API 路径，默认 /v1/bot/sendPrivateMsg；若网关报「路径错误」可尝试其他路径 */
  sendPrivateMsgPath?: string;
  /** 发送群聊消息 API 路径，默认 /v1/bot/sendGroupMsg */
  sendGroupMsgPath?: string;
};

export type ResolvedLanxinAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  config: LanxinAccountConfig;
};

export type LanxinAppTokenResponse = {
  errCode: number;
  errMsg: string;
  data?: {
    appToken: string;
    expiresIn: number;
  };
};

export type LanxinSendMessageResponse = {
  errCode: number;
  errMsg: string;
  data?: unknown;
};

export type LanxinCallbackEvent = {
  eventType?: string;
  eventId?: string;
  timestamp?: number;
  fromUserId?: string;
  toUserId?: string;
  chatId?: string;
  msgType?: string;
  content?: string;
  [key: string]: unknown;
};
