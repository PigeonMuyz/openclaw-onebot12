/**
 * OneBot 12 WebSocket 连接与 API 调用
 *
 * v12 核心差异：
 * - 统一使用 send_message + detail_type 替代 send_private_msg / send_group_msg
 * - 响应使用 status === "ok" 替代 retcode === 0
 * - ID 均为字符串
 */

import WebSocket from "ws";
import https from "https";
import http from "http";
import { writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { OneBot12AccountConfig } from "./types.js";
import { logSend } from "./send-debug-log.js";
import { shouldBlockSendInForwardMode, getActiveReplyTarget, getActiveReplySessionId } from "./reply-context.js";

const IMAGE_TEMP_DIR = join(tmpdir(), "openclaw-onebot12");
const DOWNLOAD_TIMEOUT_MS = 30000;

function downloadUrl(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith("https") ? https : http;
        const req = lib.get(url, (res) => {
            const redirect = res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location;
            if (redirect) {
                downloadUrl(redirect.startsWith("http") ? redirect : new URL(redirect, url).href).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}`));
                return;
            }
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => resolve(Buffer.concat(chunks)));
            res.on("error", reject);
        });
        req.on("error", reject);
        req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
            req.destroy();
            reject(new Error("Download timeout"));
        });
    });
}

const IMAGE_TEMP_MAX_AGE_MS = 60 * 60 * 1000;
const IMAGE_TEMP_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let imageTempCleanupTimer: ReturnType<typeof setInterval> | null = null;

function cleanupImageTemp(): void {
    try {
        const files = readdirSync(IMAGE_TEMP_DIR);
        const now = Date.now();
        for (const f of files) {
            const p = join(IMAGE_TEMP_DIR, f);
            try {
                const st = statSync(p);
                if (st.isFile() && now - st.mtimeMs > IMAGE_TEMP_MAX_AGE_MS) unlinkSync(p);
            } catch { /* ignore */ }
        }
    } catch { /* dir not exist */ }
}

async function resolveImageToLocalPath(image: string): Promise<string> {
    const trimmed = image?.trim();
    if (!trimmed) throw new Error("Empty image");
    if (/^https?:\/\//i.test(trimmed)) {
        cleanupImageTemp();
        const buf = await downloadUrl(trimmed);
        const ext = (trimmed.match(/\.(png|jpg|jpeg|gif|webp|bmp)(?:\?|$)/i)?.[1] ?? "png").toLowerCase();
        mkdirSync(IMAGE_TEMP_DIR, { recursive: true });
        const tmpPath = join(IMAGE_TEMP_DIR, `img-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
        writeFileSync(tmpPath, buf);
        return tmpPath.replace(/\\/g, "/");
    }
    if (trimmed.startsWith("base64://")) {
        cleanupImageTemp();
        const b64 = trimmed.slice(9);
        const buf = Buffer.from(b64, "base64");
        mkdirSync(IMAGE_TEMP_DIR, { recursive: true });
        const tmpPath = join(IMAGE_TEMP_DIR, `img-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
        writeFileSync(tmpPath, buf);
        return tmpPath.replace(/\\/g, "/");
    }
    if (trimmed.startsWith("file://")) return trimmed.slice(7).replace(/\\/g, "/");
    return trimmed.replace(/\\/g, "/");
}

export function startImageTempCleanup(): void {
    stopImageTempCleanup();
    imageTempCleanupTimer = setInterval(cleanupImageTemp, IMAGE_TEMP_CLEANUP_INTERVAL_MS);
}

export function stopImageTempCleanup(): void {
    if (imageTempCleanupTimer) {
        clearInterval(imageTempCleanupTimer);
        imageTempCleanupTimer = null;
    }
}

let ws: WebSocket | null = null;
const pendingEcho = new Map<string, { resolve: (v: any) => void }>();
let echoCounter = 0;

let connectionReadyResolve: (() => void) | null = null;
const connectionReadyPromise = new Promise<void>((r) => { connectionReadyResolve = r; });

function nextEcho(): string {
    return `ob12-${Date.now()}-${++echoCounter}`;
}

export function handleEchoResponse(payload: any): boolean {
    if (payload?.echo && pendingEcho.has(payload.echo)) {
        const h = pendingEcho.get(payload.echo);
        h?.resolve(payload);
        return true;
    }
    return false;
}

function getLogger(): { info?: (s: string) => void; warn?: (s: string) => void } {
    return (globalThis as any).__onebot12Api?.logger ?? {};
}

/**
 * v12 动作调用：响应用 status === "ok" 判断成功
 */
function sendOneBot12Action(wsocket: WebSocket, action: string, params: Record<string, unknown>, log = getLogger()): Promise<any> {
    const echo = nextEcho();
    const payload = { action, params, echo };

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingEcho.delete(echo);
            log.warn?.(`[onebot12] sendAction ${action} timeout`);
            reject(new Error(`OneBot12 action ${action} timeout`));
        }, 15000);

        pendingEcho.set(echo, {
            resolve: (v) => {
                clearTimeout(timeout);
                pendingEcho.delete(echo);
                if (v?.status !== "ok") log.warn?.(`[onebot12] sendAction ${action} status=${v?.status} retcode=${v?.retcode} msg=${v?.message ?? ""}`);
                resolve(v);
            },
        });

        wsocket.send(JSON.stringify(payload), (err: Error | undefined) => {
            if (err) {
                pendingEcho.delete(echo);
                clearTimeout(timeout);
                reject(err);
            }
        });
    });
}

export function getWs(): WebSocket | null { return ws; }

function setupEchoHandler(socket: WebSocket): void {
    socket.on("message", (data: Buffer) => {
        try {
            const payload = JSON.parse(data.toString());
            handleEchoResponse(payload);
        } catch { /* ignore */ }
    });
}

export async function waitForConnection(timeoutMs = 30000): Promise<WebSocket> {
    if (ws && ws.readyState === WebSocket.OPEN) return ws;
    const log = getLogger();
    log.info?.("[onebot12] waitForConnection: waiting...");
    return Promise.race([
        connectionReadyPromise.then(() => {
            if (ws && ws.readyState === WebSocket.OPEN) return ws;
            throw new Error("OneBot12 WebSocket not connected");
        }),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`OneBot12 WebSocket not connected after ${timeoutMs}ms`)), timeoutMs)
        ),
    ]);
}

export async function ensureConnection(
    getConfig: () => OneBot12AccountConfig | null,
    timeoutMs = 30000
): Promise<WebSocket> {
    if (ws && ws.readyState === WebSocket.OPEN) return ws;
    const config = getConfig();
    if (!config) throw new Error("OneBot12 not configured");
    const log = getLogger();
    log.info?.("[onebot12] connecting...");
    const socket = await connectWs(config);
    setupEchoHandler(socket);
    setWs(socket);
    return socket;
}

/**
 * v12 统一发送消息 API：send_message + detail_type
 */
export async function sendPrivateMsg(
    userId: string,
    text: string,
    getConfig?: () => OneBot12AccountConfig | null
): Promise<string | undefined> {
    if (shouldBlockSendInForwardMode("private", userId)) {
        logSend("connection", "sendPrivateMsg", { targetId: userId, blocked: true, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
        return undefined;
    }
    logSend("connection", "sendPrivateMsg", { targetType: "user", targetId: userId, textLen: text?.length, sessionId: getActiveReplyTarget() });
    const socket = getConfig ? await ensureConnection(getConfig) : await waitForConnection();
    const res = await sendOneBot12Action(socket, "send_message", {
        detail_type: "private",
        user_id: userId,
        message: [{ type: "text", data: { text } }],
    });
    if (res?.status !== "ok") {
        throw new Error(res?.message ?? `OneBot12 send_message (private) failed (status=${res?.status})`);
    }
    return res?.data?.message_id as string | undefined;
}

export async function sendGroupMsg(
    groupId: string,
    text: string,
    getConfig?: () => OneBot12AccountConfig | null
): Promise<string | undefined> {
    if (shouldBlockSendInForwardMode("group", groupId)) {
        logSend("connection", "sendGroupMsg", { targetId: groupId, blocked: true });
        return undefined;
    }
    logSend("connection", "sendGroupMsg", { targetType: "group", targetId: groupId, textLen: text?.length });
    const socket = getConfig ? await ensureConnection(getConfig) : await waitForConnection();
    const res = await sendOneBot12Action(socket, "send_message", {
        detail_type: "group",
        group_id: groupId,
        message: [{ type: "text", data: { text } }],
    });
    if (res?.status !== "ok") {
        throw new Error(res?.message ?? `OneBot12 send_message (group) failed (status=${res?.status})`);
    }
    return res?.data?.message_id as string | undefined;
}

export async function sendGroupImage(
    groupId: string,
    image: string,
    log: { info?: (s: string) => void; warn?: (s: string) => void } = getLogger(),
    getConfig?: () => OneBot12AccountConfig | null
): Promise<string | undefined> {
    if (shouldBlockSendInForwardMode("group", groupId)) return undefined;
    const socket = getConfig ? await ensureConnection(getConfig) : await waitForConnection();
    try {
        const filePath = image.startsWith("[") ? null : await resolveImageToLocalPath(image);
        const seg = image.startsWith("[")
            ? JSON.parse(image)
            : [{ type: "image", data: { url: `file://${filePath!}` } }];
        const res = await sendOneBot12Action(socket, "send_message", { detail_type: "group", group_id: groupId, message: seg }, log);
        if (res?.status !== "ok") throw new Error(res?.message ?? `send_message (group image) failed`);
        return res?.data?.message_id as string | undefined;
    } catch (error) {
        log.warn?.(`[onebot12] sendGroupImage error: ${error}`);
    }
}

export async function sendPrivateImage(
    userId: string,
    image: string,
    log: { info?: (s: string) => void; warn?: (s: string) => void } = getLogger(),
    getConfig?: () => OneBot12AccountConfig | null
): Promise<string | undefined> {
    if (shouldBlockSendInForwardMode("private", userId)) return undefined;
    const socket = getConfig ? await ensureConnection(getConfig) : await waitForConnection();
    const filePath = image.startsWith("[") ? null : await resolveImageToLocalPath(image);
    const seg = image.startsWith("[")
        ? JSON.parse(image)
        : [{ type: "image", data: { url: `file://${filePath!}` } }];
    const res = await sendOneBot12Action(socket, "send_message", { detail_type: "private", user_id: userId, message: seg }, log);
    if (res?.status !== "ok") throw new Error(res?.message ?? `send_message (private image) failed`);
    return res?.data?.message_id as string | undefined;
}

export async function sendGroupForwardMsg(
    groupId: string,
    messages: Array<{ type: string; data: Record<string, unknown> }>,
    getConfig?: () => OneBot12AccountConfig | null
): Promise<void> {
    const socket = getConfig ? await ensureConnection(getConfig) : await waitForConnection();
    const res = await sendOneBot12Action(socket, "send_message", {
        detail_type: "group",
        group_id: groupId,
        message: [{ type: "forward", data: { messages } }],
    });
    if (res?.status !== "ok") throw new Error(res?.message ?? `send forward (group) failed`);
}

export async function sendPrivateForwardMsg(
    userId: string,
    messages: Array<{ type: string; data: Record<string, unknown> }>,
    getConfig?: () => OneBot12AccountConfig | null
): Promise<void> {
    const socket = getConfig ? await ensureConnection(getConfig) : await waitForConnection();
    const res = await sendOneBot12Action(socket, "send_message", {
        detail_type: "private",
        user_id: userId,
        message: [{ type: "forward", data: { messages } }],
    });
    if (res?.status !== "ok") throw new Error(res?.message ?? `send forward (private) failed`);
}

/** 撤回消息 */
export async function deleteMsg(messageId: string): Promise<void> {
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("OneBot12 WebSocket not connected");
    await sendOneBot12Action(ws, "delete_message", { message_id: messageId });
}

/** 获取单条消息 */
export async function getMsg(messageId: string): Promise<{
    time: number;
    detail_type: string;
    message_id: string;
    sender: { user_id?: string; nickname?: string };
    message: unknown[];
} | null> {
    if (!ws || ws.readyState !== WebSocket.OPEN) return null;
    try {
        const res = await sendOneBot12Action(ws, "get_message", { message_id: messageId });
        if (res?.status === "ok" && res?.data) return res.data;
        return null;
    } catch { return null; }
}

/** 获取登录信息（v12: get_self_info） */
export async function getSelfInfo(): Promise<{ user_id: string; user_name?: string } | null> {
    if (!ws || ws.readyState !== WebSocket.OPEN) return null;
    try {
        const res = await sendOneBot12Action(ws, "get_self_info", {});
        if (res?.status === "ok" && res?.data) return res.data;
        return null;
    } catch { return null; }
}

/** 头像 URL */
export function getAvatarUrl(userId: string, size: number = 640): string {
    return `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=${size}`;
}

/** 连接 WebSocket */
export async function connectWs(config: OneBot12AccountConfig): Promise<WebSocket> {
    const url = new URL(config.endpoint);
    const headers: Record<string, string> = {};
    if (config.token) {
        if (config.authType === "bearer") {
            headers["Authorization"] = `Bearer ${config.token}`;
        } else if (config.authType === "query") {
            url.searchParams.set("access_token", config.token);
        }
    }
    const w = new WebSocket(url.toString(), { headers });
    await new Promise<void>((resolve, reject) => {
        w.on("open", () => resolve());
        w.on("error", reject);
    });
    return w;
}

export function setWs(socket: WebSocket | null): void {
    ws = socket;
    if (socket && socket.readyState === WebSocket.OPEN && connectionReadyResolve) {
        connectionReadyResolve();
        connectionReadyResolve = null;
    }
}

export function stopConnection(): void {
    if (ws) { ws.close(); ws = null; }
}
