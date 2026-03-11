/**
 * OneBot12 Channel 插件定义
 */

import { getOneBot12Config, listAccountIds } from "./config.js";
import { sendTextMessage, sendMediaMessage } from "./send.js";

const meta = {
    id: "onebot12",
    label: "OneBot12",
    selectionLabel: "OneBot12 (QQ/WeChat/Lagrange)",
    docsPath: "/channels/onebot12",
    docsLabel: "onebot12",
    blurb: "OneBot v12 protocol via WebSocket",
    aliases: ["qq12", "ob12"],
    order: 86,
};

function normalizeTarget(raw: string): string | undefined {
    const trimmed = raw?.trim();
    if (!trimmed) return undefined;
    return trimmed.replace(/^(onebot12|ob12):/i, "").trim();
}

function parseTarget(to: string): { type: "user" | "group"; id: string } | null {
    const t = to.replace(/^(onebot12|ob12):/i, "").trim();
    if (!t) return null;
    if (t.startsWith("group:")) return { type: "group", id: t.slice(6) };
    if (t.startsWith("user:")) return { type: "user", id: t.slice(5) };
    // 如果是纯数字，尝试判断
    if (/^\d+$/.test(t)) {
        return { type: Number(t) > 100000000 ? "user" : "group", id: t };
    }
    return { type: "user", id: t };
}

export const OneBot12ChannelPlugin = {
    id: "onebot12",
    meta: { ...meta },
    capabilities: {
        chatTypes: ["direct", "group"] as const,
        media: true,
        reactions: false,
        threads: false,
        polls: false,
    },
    reload: { configPrefixes: ["channels.onebot12"] as const },
    config: {
        listAccountIds: (cfg: any) => listAccountIds(cfg),
        resolveAccount: (cfg: any, accountId?: string) => {
            const id = accountId ?? "default";
            const acc = cfg?.channels?.onebot12?.accounts?.[id];
            if (acc) return { accountId: id, ...acc };
            const ch = cfg?.channels?.onebot12;
            if (ch?.endpoint) return { accountId: id, ...ch };
            return { accountId: id };
        },
    },
    groups: {
        resolveRequireMention: () => true,
    },
    messaging: {
        normalizeTarget,
        targetResolver: {
            looksLikeId: (raw: string) => {
                const trimmed = raw.trim();
                if (!trimmed) return false;
                return /^group:.+$/.test(trimmed) || /^user:.+$/.test(trimmed) || /^\d{6,}$/.test(trimmed);
            },
            hint: "user:<用户ID> 或 group:<群ID>",
        },
    },
    outbound: {
        deliveryMode: "direct" as const,
        chunker: (text: string, limit: number) => {
            if (!text) return [];
            if (limit <= 0 || text.length <= limit) return [text];
            const chunks: string[] = [];
            let remaining = text;
            while (remaining.length > limit) {
                const window = remaining.slice(0, limit);
                const lastNewline = window.lastIndexOf("\n");
                const lastSpace = window.lastIndexOf(" ");
                let breakIdx = lastNewline > 0 ? lastNewline : lastSpace;
                if (breakIdx <= 0) breakIdx = limit;
                const rawChunk = remaining.slice(0, breakIdx);
                const chunk = rawChunk.trimEnd();
                if (chunk.length > 0) chunks.push(chunk);
                const brokeOnSeparator = breakIdx < remaining.length && /\s/.test(remaining[breakIdx]);
                const nextStart = Math.min(remaining.length, breakIdx + (brokeOnSeparator ? 1 : 0));
                remaining = remaining.slice(nextStart).trimStart();
            }
            if (remaining.length) chunks.push(remaining);
            return chunks;
        },
        chunkerMode: "text" as const,
        textChunkLimit: 4000,
        resolveTarget: ({ to }: { to?: string }) => {
            const t = to?.trim();
            if (!t) return { ok: false, error: new Error("OneBot12 requires --to <user_id|group_id>") };
            return { ok: true, to: t };
        },
        sendText: async ({ to, text, accountId, cfg }: { to: string; text: string; accountId?: string; cfg?: any }) => {
            const api = cfg ? { config: cfg } : (globalThis as any).__onebot12Api;
            const config = getOneBot12Config(api, accountId);
            if (!config) return { channel: "onebot12", ok: false, messageId: "", error: new Error("OneBot12 not configured") };
            const getConfig = () => getOneBot12Config(api, accountId);
            try {
                const result = await sendTextMessage(to, text, getConfig, cfg);
                if (!result.ok) return { channel: "onebot12", ok: false, messageId: "", error: new Error(result.error) };
                return { channel: "onebot12", ok: true, messageId: result.messageId ?? "" };
            } catch (e) {
                return { channel: "onebot12", ok: false, messageId: "", error: e instanceof Error ? e : new Error(String(e)) };
            }
        },
        sendMedia: async (params: { to: string; text?: string; mediaUrl?: string; media?: string; accountId?: string; cfg?: any }) => {
            const { to, text, accountId, cfg } = params;
            const mediaUrl = params.mediaUrl ?? params.media;
            const api = cfg ? { config: cfg } : (globalThis as any).__onebot12Api;
            const config = getOneBot12Config(api, accountId);
            if (!config) return { channel: "onebot12", ok: false, messageId: "", error: new Error("OneBot12 not configured") };
            if (!mediaUrl?.trim()) return { channel: "onebot12", ok: false, messageId: "", error: new Error("mediaUrl is required") };
            const getConfig = () => getOneBot12Config(api, accountId);
            try {
                const result = await sendMediaMessage(to, mediaUrl, text, getConfig, cfg);
                if (!result.ok) return { channel: "onebot12", ok: false, messageId: "", error: new Error(result.error) };
                return { channel: "onebot12", ok: true, messageId: result.messageId ?? "" };
            } catch (e) {
                return { channel: "onebot12", ok: false, messageId: "", error: e instanceof Error ? e : new Error(String(e)) };
            }
        },
    },
};
