/**
 * OneBot 12 消息发送 — 文本与媒体
 */

import {
  sendPrivateMsg,
  sendGroupMsg,
  sendPrivateImage,
  sendGroupImage,
} from "./connection.js";
import { resolveTargetForReply, getForwardSuppressDelivery, isTargetActiveReply, getActiveReplyTarget, getActiveReplySessionId } from "./reply-context.js";
import { logSend } from "./send-debug-log.js";
import { getRenderMarkdownToPlain, getCollapseDoubleNewlines } from "./config.js";
import { markdownToPlain, collapseDoubleNewlines } from "./markdown.js";
import type { OneBot12AccountConfig } from "./types.js";

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/** v12 目标解析 — ID 为字符串 */
function parseTarget(to: string): { type: "user" | "group"; id: string } | null {
  const t = to.replace(/^(onebot12|ob12):/i, "").trim();
  if (!t) return null;
  if (t.startsWith("group:")) return { type: "group", id: t.slice(6) };
  if (t.startsWith("user:")) return { type: "user", id: t.slice(5) };
  if (/^\d+$/.test(t)) {
    return { type: Number(t) > 100000000 ? "user" : "group", id: t };
  }
  return { type: "user", id: t };
}

type ConfigGetter = () => OneBot12AccountConfig | null;

export async function sendTextMessage(
  to: string,
  text: string,
  getConfig?: ConfigGetter,
  cfg?: any
): Promise<SendResult> {
  const forwardSuppress = getForwardSuppressDelivery();
  const suppressed = forwardSuppress && isTargetActiveReply(to);
  if (suppressed) return { ok: true, messageId: "" };

  const resolvedTo = resolveTargetForReply(to);
  const target = parseTarget(resolvedTo);
  if (!target) return { ok: false, error: `Invalid target: ${to}` };
  if (!text?.trim()) return { ok: false, error: "No text provided" };

  let finalText = getRenderMarkdownToPlain(cfg) ? markdownToPlain(text) : text.trim();
  if (getCollapseDoubleNewlines(cfg)) finalText = collapseDoubleNewlines(finalText);

  try {
    let messageId: string | undefined;
    if (target.type === "group") {
      messageId = await sendGroupMsg(target.id, finalText, getConfig);
    } else {
      messageId = await sendPrivateMsg(target.id, finalText, getConfig);
    }
    return { ok: true, messageId: messageId ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendMediaMessage(
  to: string,
  mediaUrl: string,
  text?: string,
  getConfig?: ConfigGetter,
  cfg?: any
): Promise<SendResult> {
  const forwardSuppress = getForwardSuppressDelivery();
  const suppressed = forwardSuppress && isTargetActiveReply(to);
  if (suppressed) return { ok: true, messageId: "" };

  const resolvedTo = resolveTargetForReply(to);
  const target = parseTarget(resolvedTo);
  if (!target) return { ok: false, error: `Invalid target: ${to}` };
  if (!mediaUrl?.trim()) return { ok: false, error: "No mediaUrl provided" };

  let finalText = text?.trim() ? (getRenderMarkdownToPlain(cfg) ? markdownToPlain(text) : text.trim()) : "";
  if (finalText && getCollapseDoubleNewlines(cfg)) finalText = collapseDoubleNewlines(finalText);

  try {
    let messageId: string | undefined;
    if (finalText) {
      if (target.type === "group") messageId = await sendGroupMsg(target.id, finalText, getConfig);
      else messageId = await sendPrivateMsg(target.id, finalText, getConfig);
    }
    if (target.type === "group") {
      const id = await sendGroupImage(target.id, mediaUrl, undefined, getConfig);
      if (id != null) messageId = id;
    } else {
      const id = await sendPrivateImage(target.id, mediaUrl, undefined, getConfig);
      if (id != null) messageId = id;
    }
    return { ok: true, messageId: messageId ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
