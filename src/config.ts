/**
 * OneBot 12 配置解析
 */

import type { OneBot12AccountConfig } from "./types.js";

export function getOneBot12Config(api: any, accountId?: string): OneBot12AccountConfig | null {
  const cfg = api?.config ?? (globalThis as any).__onebot12GatewayConfig;
  const id = accountId ?? "default";

  const channel = cfg?.channels?.onebot12;
  const account = channel?.accounts?.[id];
  if (account) {
    const { endpoint, token, authType, selfId, platform } = account;
    if (endpoint) {
      return {
        accountId: id,
        endpoint,
        token,
        authType: authType ?? "none",
        selfId,
        platform: platform ?? "qq",
        enabled: account.enabled !== false,
      };
    }
  }

  if (channel?.endpoint) {
    return {
      accountId: id,
      endpoint: channel.endpoint,
      token: channel.token,
      authType: channel.authType ?? "none",
      selfId: channel.selfId,
      platform: channel.platform ?? "qq",
    };
  }

  const endpoint = process.env.ONEBOT12_WS_ENDPOINT;
  const token = process.env.ONEBOT12_WS_TOKEN;
  const authType = process.env.ONEBOT12_WS_AUTH_TYPE as "none" | "bearer" | "query" | undefined;

  if (endpoint) {
    return {
      accountId: id,
      endpoint,
      token: token || undefined,
      authType: authType ?? "none",
    };
  }

  return null;
}

/** 是否将 Markdown 渲染为纯文本 */
export function getRenderMarkdownToPlain(cfg: any): boolean {
  const v = cfg?.channels?.onebot12?.renderMarkdownToPlain;
  return v === undefined ? true : Boolean(v);
}

/** 是否压缩连续换行 */
export function getCollapseDoubleNewlines(cfg: any): boolean {
  const v = cfg?.channels?.onebot12?.collapseDoubleNewlines;
  return v === undefined ? true : Boolean(v);
}

/** 白名单用户 ID 列表（v12 中 ID 为字符串） */
export function getWhitelistUserIds(cfg: any): string[] {
  const v = cfg?.channels?.onebot12?.whitelistUserIds;
  if (!Array.isArray(v)) return [];
  return v.map((x: unknown) => String(x)).filter(Boolean);
}

/** 私聊消息前缀符号 */
export function getPrivateMessagePrefix(cfg: any): string {
  const v = cfg?.channels?.onebot12?.privateMessagePrefix;
  return typeof v === "string" ? v.trim() : "";
}

/** OG 图片渲染主题 */
export function getOgImageRenderTheme(cfg: any): "default" | "dust" | string {
  const v = cfg?.channels?.onebot12?.ogImageRenderTheme;
  const path = (cfg?.channels?.onebot12?.ogImageRenderThemePath ?? "").trim();
  if (v === "dust") return "dust";
  if (v === "custom" && path.length > 0) return path;
  return "default";
}

export function listAccountIds(apiOrCfg: any): string[] {
  const cfg = apiOrCfg?.config ?? apiOrCfg ?? (globalThis as any).__onebot12GatewayConfig;
  const accounts = cfg?.channels?.onebot12?.accounts;
  if (accounts && Object.keys(accounts).length > 0) {
    return Object.keys(accounts);
  }
  if (cfg?.channels?.onebot12?.endpoint) return ["default"];
  return [];
}
