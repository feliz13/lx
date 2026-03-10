import type { ResolvedLanxinAccount } from "./types.js";
import { getLanxinAppToken } from "./api.js";

export async function probeLanxin(account: ResolvedLanxinAccount): Promise<{ ok: boolean }> {
  try {
    await getLanxinAppToken(account);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
