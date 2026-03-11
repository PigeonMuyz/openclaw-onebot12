/**
 * OneBot v12 消息解析
 */

import type { OneBot12Message } from "./types.js";

/** 从 v12 消息段中提取纯文本（仅 text 段） */
export function getTextFromSegments(msg: OneBot12Message): string {
  const arr = msg?.message;
  if (!Array.isArray(arr)) return "";
  return arr
    .filter((m) => m?.type === "text")
    .map((m) => m?.data?.text ?? "")
    .join("");
}

/** 获取消息文本。v12 没有 raw_message，优先 alt_message，否则从 segments 解析 */
export function getRawText(msg: OneBot12Message): string {
  if (!msg) return "";
  if (typeof msg.alt_message === "string" && msg.alt_message) {
    return msg.alt_message;
  }
  return getTextFromSegments(msg);
}

/** 检查消息是否 @了指定用户（v12 用 mention 段替代 at 段） */
export function isMentioned(msg: OneBot12Message, selfId: string): boolean {
  const arr = msg.message;
  if (!Array.isArray(arr)) return false;
  return arr.some(
    (m) => m?.type === "mention" && String(m?.data?.user_id) === selfId
  );
}

/** 获取引用/回复的消息 ID（v12 reply 段） */
export function getReplyMessageId(msg: OneBot12Message): string | undefined {
  if (!msg?.message || !Array.isArray(msg.message)) return undefined;
  const replySeg = msg.message.find((m) => m?.type === "reply");
  if (!replySeg?.data) return undefined;
  const id = replySeg.data.message_id;
  return id != null ? String(id) : undefined;
}

/** 从 message 内容中提取文本（用于引用消息内容提取） */
export function getTextFromMessageContent(content: unknown[] | string | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const m of content) {
    const seg = m as { type?: string; data?: Record<string, unknown> };
    if (seg?.type === "text") {
      const t = (seg.data?.text as string) ?? "";
      if (t) parts.push(t);
    } else if (seg?.type === "image") {
      const url = (seg.data?.url as string) ?? (seg.data?.file_id as string) ?? "";
      parts.push(url ? `[图片: ${url}]` : "[图片]");
    }
  }
  return parts.join("");
}
