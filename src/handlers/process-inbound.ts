/**
 * OneBot 12 入站消息处理
 */

import type { OneBot12Message } from "../types.js";
import { getOneBot12Config } from "../config.js";
import {
    getRawText,
    getTextFromSegments,
    getReplyMessageId,
    getTextFromMessageContent,
    isMentioned,
} from "../message.js";
import { getRenderMarkdownToPlain, getCollapseDoubleNewlines, getWhitelistUserIds, getOgImageRenderTheme, getPrivateMessagePrefix } from "../config.js";
import { markdownToPlain, collapseDoubleNewlines } from "../markdown.js";
import { markdownToImage } from "../og-image.js";
import {
    sendPrivateMsg,
    sendGroupMsg,
    sendPrivateImage,
    sendGroupImage,
    sendGroupForwardMsg,
    sendPrivateForwardMsg,
    getMsg,
} from "../connection.js";
import { setActiveReplyTarget, clearActiveReplyTarget, setActiveReplySessionId, setForwardSuppressDelivery } from "../reply-context.js";
import { loadPluginSdk, getSdk } from "../sdk.js";

const DEFAULT_HISTORY_LIMIT = 20;
export const sessionHistories = new Map<string, Array<{ sender: string; body: string; timestamp: number; messageId: string }>>();

export async function processInboundMessage(api: any, msg: OneBot12Message): Promise<void> {
    await loadPluginSdk();
    const { buildPendingHistoryContextFromMap, recordPendingHistoryEntry, clearHistoryEntriesIfEnabled } = getSdk();

    const runtime = api.runtime;
    if (!runtime?.channel?.reply?.dispatchReplyWithBufferedBlockDispatcher) {
        api.logger?.warn?.("[onebot12] runtime.channel.reply not available");
        return;
    }

    const config = getOneBot12Config(api);
    if (!config) {
        api.logger?.warn?.("[onebot12] not configured");
        return;
    }

    // v12: self 是对象 { platform, user_id }
    const selfId = msg.self?.user_id ?? config.selfId ?? "";
    if (msg.user_id && msg.user_id === selfId) return;

    const replyId = getReplyMessageId(msg);
    let messageText: string;
    if (replyId != null) {
        const userText = getTextFromSegments(msg);
        try {
            const quoted = await getMsg(replyId);
            const quotedText = quoted ? getTextFromMessageContent(quoted.message) : "";
            const senderLabel = quoted?.sender?.nickname ?? quoted?.sender?.user_id ?? "某人";
            messageText = quotedText.trim()
                ? `[引用 ${String(senderLabel)} 的消息：${quotedText.trim()}]\n${userText}`
                : userText;
        } catch {
            messageText = userText;
        }
    } else {
        messageText = getRawText(msg);
    }
    if (!messageText?.trim()) {
        api.logger?.info?.("[onebot12] ignoring empty message");
        return;
    }

    // v12: detail_type 替代 message_type
    const isGroup = msg.detail_type === "group";
    const cfg = api.config;
    const requireMention = (cfg?.channels?.onebot12 as any)?.requireMention ?? true;

    // ===== 群聊过滤 =====
    if (isGroup) {
        if (requireMention && !isMentioned(msg, selfId)) {
            api.logger?.info?.("[onebot12] ignoring group message without @mention");
            return;
        }
        const whitelist = getWhitelistUserIds(cfg);
        if (whitelist.length > 0 && !whitelist.includes(String(msg.user_id))) {
            api.logger?.info?.(`[onebot12] group: user ${msg.user_id} not in whitelist, ignored`);
            return;
        }
    }

    // ===== 私聊过滤 =====
    if (!isGroup) {
        const whitelist = getWhitelistUserIds(cfg);
        if (whitelist.length > 0 && !whitelist.includes(String(msg.user_id))) {
            const denyMsg = "权限不足，请向管理员申请权限";
            const getConfig = () => getOneBot12Config(api);
            try {
                await sendPrivateMsg(String(msg.user_id), denyMsg, getConfig);
            } catch (_) {}
            api.logger?.info?.(`[onebot12] private: user ${msg.user_id} not in whitelist, denied`);
            return;
        }
        const prefix = getPrivateMessagePrefix(cfg);
        if (prefix) {
            if (!messageText.trimStart().startsWith(prefix)) {
                api.logger?.info?.(`[onebot12] private: message missing prefix "${prefix}", ignored`);
                return;
            }
            messageText = messageText.trimStart().slice(prefix.length).trimStart();
            if (!messageText) {
                api.logger?.info?.("[onebot12] private: message is only prefix, ignored");
                return;
            }
        }
    }

    const userId = String(msg.user_id ?? "");
    const groupId = msg.group_id;
    // 用户导向：同一用户不管在群聊还是私聊中都共享同一个 AI 上下文
    const sessionId = `onebot12:user:${userId}`.toLowerCase();

    const route = runtime.channel.routing?.resolveAgentRoute?.({
        cfg,
        sessionKey: sessionId,
        channel: "onebot12",
        accountId: config.accountId ?? "default",
    }) ?? { agentId: "main" };

    const storePath =
        runtime.channel.session?.resolveStorePath?.(cfg?.session?.store, {
            agentId: route.agentId,
        }) ?? "";

    const envelopeOptions = runtime.channel.reply?.resolveEnvelopeFormatOptions?.(cfg) ?? {};
    const chatType = isGroup ? "group" : "direct";
    const fromLabel = userId;

    const formattedBody =
        runtime.channel.reply?.formatInboundEnvelope?.({
            channel: "OneBot12",
            from: fromLabel,
            timestamp: Date.now(),
            body: messageText,
            chatType,
            sender: { name: fromLabel, id: userId },
            envelope: envelopeOptions,
        }) ?? { content: [{ type: "text", text: messageText }] };

    const body = buildPendingHistoryContextFromMap
        ? buildPendingHistoryContextFromMap({
            historyMap: sessionHistories,
            historyKey: sessionId,
            limit: DEFAULT_HISTORY_LIMIT,
            currentMessage: formattedBody,
            formatEntry: (entry: any) =>
                runtime.channel.reply?.formatInboundEnvelope?.({
                    channel: "OneBot12",
                    from: fromLabel,
                    timestamp: entry.timestamp,
                    body: entry.body,
                    chatType,
                    senderLabel: entry.sender,
                    envelope: envelopeOptions,
                }) ?? { content: [{ type: "text", text: entry.body }] },
        })
        : formattedBody;

    if (recordPendingHistoryEntry) {
        recordPendingHistoryEntry({
            historyMap: sessionHistories,
            historyKey: sessionId,
            entry: {
                sender: fromLabel,
                body: messageText,
                timestamp: Date.now(),
                messageId: `onebot12-${Date.now()}`,
            },
            limit: DEFAULT_HISTORY_LIMIT,
        });
    }

    const replyTarget = isGroup ? `onebot12:group:${groupId}` : `onebot12:${userId}`;
    const ctxPayload = {
        Body: body,
        RawBody: messageText,
        From: replyTarget,
        To: replyTarget,
        SessionKey: sessionId,
        AccountId: config.accountId ?? "default",
        ChatType: chatType,
        ConversationLabel: replyTarget,
        SenderName: fromLabel,
        SenderId: userId,
        Provider: "onebot12",
        Surface: "onebot12",
        MessageSid: `onebot12-${Date.now()}`,
        Timestamp: Date.now(),
        OriginatingChannel: "onebot12",
        OriginatingTo: replyTarget,
        CommandAuthorized: true,
        DeliveryContext: {
            channel: "onebot12",
            to: replyTarget,
            accountId: config.accountId ?? "default",
        },
        _onebot12: { userId, groupId, isGroup },
    };

    if (runtime.channel.session?.recordInboundSession) {
        await runtime.channel.session.recordInboundSession({
            storePath,
            sessionKey: sessionId,
            ctx: ctxPayload,
            updateLastRoute: !isGroup ? { sessionKey: sessionId, channel: "onebot12", to: userId, accountId: config.accountId ?? "default" } : undefined,
            onRecordError: (err: any) => api.logger?.warn?.(`[onebot12] recordInboundSession: ${err}`),
        });
    }

    if (runtime.channel.activity?.record) {
        runtime.channel.activity.record({ channel: "onebot12", accountId: config.accountId ?? "default", direction: "inbound" });
    }

    const onebotCfg = (cfg?.channels?.onebot12 as Record<string, unknown>) ?? {};
    const longMessageMode = (onebotCfg.longMessageMode as "normal" | "og_image" | "forward") ?? "normal";
    const longMessageThreshold = (onebotCfg.longMessageThreshold as number) ?? 300;

    const replySessionId = `onebot12-reply-${Date.now()}-${sessionId}`;
    setActiveReplyTarget(replyTarget);
    setActiveReplySessionId(replySessionId);
    if (longMessageMode === "forward") setForwardSuppressDelivery(true);

    const deliveredChunks: Array<{ index: number; text?: string; rawText?: string; mediaUrl?: string }> = [];
    let chunkIndex = 0;
    const getConfig = () => getOneBot12Config(api);

    const doSendChunk = async (
        effectiveIsGroup: boolean,
        effectiveGroupId: string | undefined,
        uid: string | undefined,
        text: string,
        mediaUrl: string | undefined
    ) => {
        if (text) {
            if (effectiveIsGroup && effectiveGroupId) await sendGroupMsg(effectiveGroupId, text, getConfig);
            else if (uid) await sendPrivateMsg(uid, text, getConfig);
        }
        if (mediaUrl) {
            if (effectiveIsGroup && effectiveGroupId) await sendGroupImage(effectiveGroupId, mediaUrl, api.logger, getConfig);
            else if (uid) await sendPrivateImage(uid, mediaUrl, api.logger, getConfig);
        }
    };

    try {
        await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
            ctx: ctxPayload,
            cfg,
            dispatcherOptions: {
                deliver: async (payload: unknown, info: { kind: string }) => {
                    const p = payload as { text?: string; body?: string; mediaUrl?: string; mediaUrls?: string[] } | string;
                    const replyText = typeof p === "string" ? p : (p?.text ?? p?.body ?? "");
                    const mediaUrl = typeof p === "string" ? undefined : (p?.mediaUrl ?? p?.mediaUrls?.[0]);
                    const trimmed = (replyText || "").trim();
                    if ((!trimmed || trimmed === "NO_REPLY" || trimmed.endsWith("NO_REPLY")) && !mediaUrl) return;

                    const { userId: uid, groupId: gid, isGroup: ig } = (ctxPayload as any)._onebot12 || {};
                    const sessionKey = String((ctxPayload as any).SessionKey ?? sessionId);
                    const groupMatch = sessionKey.match(/^onebot12:group:(.+)$/i);
                    const effectiveIsGroup = groupMatch != null || Boolean(ig);
                    const effectiveGroupId = (groupMatch ? groupMatch[1] : undefined) ?? gid;

                    const usePlain = getRenderMarkdownToPlain(cfg);
                    let textPlain = usePlain ? markdownToPlain(trimmed) : trimmed;
                    if (getCollapseDoubleNewlines(cfg)) textPlain = collapseDoubleNewlines(textPlain);

                    deliveredChunks.push({
                        index: chunkIndex++,
                        text: textPlain || undefined,
                        rawText: trimmed || undefined,
                        mediaUrl: mediaUrl || undefined,
                    });

                    const shouldSendNow = longMessageMode === "normal";
                    if (longMessageMode === "forward" && info.kind !== "final") return;

                    try {
                        if (shouldSendNow) {
                            await doSendChunk(effectiveIsGroup, effectiveGroupId, uid, textPlain, mediaUrl);
                        }
                        if (info.kind === "final") {
                            if (!shouldSendNow) {
                                setForwardSuppressDelivery(false);
                                for (const c of deliveredChunks) {
                                    if (c.text || c.mediaUrl) await doSendChunk(effectiveIsGroup, effectiveGroupId, uid, c.text ?? "", c.mediaUrl);
                                }
                            }
                            if (clearHistoryEntriesIfEnabled) {
                                clearHistoryEntriesIfEnabled({
                                    historyMap: sessionHistories,
                                    historyKey: sessionId,
                                    limit: DEFAULT_HISTORY_LIMIT,
                                });
                            }
                        }
                    } catch (e: any) {
                        api.logger?.error?.(`[onebot12] deliver failed: ${e?.message}`);
                    }
                },
                onError: async (err: any, info: any) => {
                    api.logger?.error?.(`[onebot12] ${info?.kind} reply failed: ${err}`);
                },
            },
            replyOptions: { disableBlockStreaming: true },
        });
    } catch (err: any) {
        api.logger?.error?.(`[onebot12] dispatch failed: ${err?.message}`);
        try {
            const { userId: uid, groupId: gid, isGroup: ig } = (ctxPayload as any)._onebot12 || {};
            if (ig && gid) await sendGroupMsg(gid, `处理失败: ${err?.message?.slice(0, 80) || "未知错误"}`);
            else if (uid) await sendPrivateMsg(uid, `处理失败: ${err?.message?.slice(0, 80) || "未知错误"}`);
        } catch (_) { }
    } finally {
        setForwardSuppressDelivery(false);
        setActiveReplySessionId(null);
        clearActiveReplyTarget();
    }
}
