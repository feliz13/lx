import { DmPolicySchema, GroupPolicySchema, MarkdownConfigSchema } from "openclaw/plugin-sdk";
import { z } from "zod";

const allowFromEntry = z.union([z.string(), z.number()]);

const lanxinGroupSchema = z
  .object({
    requireMention: z.boolean().optional(),
    enabled: z.boolean().optional(),
    allow: z.boolean().optional(),
    users: z.array(allowFromEntry).optional(),
  })
  .strict();

export const LanxinAccountSchemaBase = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    markdown: MarkdownConfigSchema.optional(),
    appId: z.string().optional(),
    appSecret: z.string().optional(),
    gatewayUrl: z.string().url().optional(),
    passportUrl: z.string().url().optional(),
    callbackKey: z.string().optional(),
    callbackSignToken: z.string().optional(),
    webhookPath: z.string().optional(),
    webhookUrl: z.string().url().optional(),
    allowFrom: z.array(allowFromEntry).optional(),
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    groupAllowFrom: z.array(allowFromEntry).optional(),
    groups: z.record(z.string(), lanxinGroupSchema.optional()).optional(),
    requireMention: z.boolean().optional(),
    mediaMaxMb: z.number().positive().optional(),
    sendPrivateMsgPath: z.string().optional(),
    sendGroupMsgPath: z.string().optional(),
  })
  .strict();

export const LanxinConfigSchema = LanxinAccountSchemaBase.extend({
  accounts: z.record(z.string(), LanxinAccountSchemaBase.optional()).optional(),
  defaultAccount: z.string().optional(),
});
