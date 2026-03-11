/**
 * OneBot 12 WebSocket 服务（含自动无限重连）
 */

import type { OneBot12Message } from "./types.js";
import { getOneBot12Config } from "./config.js";
import { connectWs, setWs, stopConnection, handleEchoResponse, startImageTempCleanup, stopImageTempCleanup } from "./connection.js";
import { processInboundMessage } from "./handlers/process-inbound.js";

const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 60000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let shouldReconnect = true;

function clearReconnectTimer(): void {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function setupWsListeners(ws: any, api: any, attempt: number): void {
    ws.on("message", (data: Buffer) => {
        try {
            const payload = JSON.parse(data.toString());
            if (handleEchoResponse(payload)) return;

            // v12: 元事件用 type === "meta"
            if (payload.type === "meta" && payload.detail_type === "heartbeat") return;

            // v12: 消息事件用 type === "message"
            const msg = payload as OneBot12Message;
            if (msg.type === "message" && (msg.detail_type === "private" || msg.detail_type === "group")) {
                processInboundMessage(api, msg).catch((e) => {
                    api.logger?.error?.(`[onebot12] processInboundMessage: ${e?.message}`);
                });
            }
        } catch (e: any) {
            api.logger?.error?.(`[onebot12] parse message: ${e?.message}`);
        }
    });

    ws.on("close", () => {
        api.logger?.warn?.("[onebot12] WebSocket closed");
        setWs(null);
        scheduleReconnect(api, 0);
    });

    ws.on("error", (e: Error) => {
        api.logger?.error?.(`[onebot12] WebSocket error: ${e?.message}`);
    });
}

function scheduleReconnect(api: any, attempt: number): void {
    if (!shouldReconnect) return;
    clearReconnectTimer();
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, attempt), RECONNECT_MAX_MS);
    api.logger?.info?.(`[onebot12] 将在 ${(delay / 1000).toFixed(0)}s 后重连（第 ${attempt + 1} 次）`);
    reconnectTimer = setTimeout(() => doConnect(api, attempt + 1), delay);
}

async function doConnect(api: any, attempt: number): Promise<void> {
    if (!shouldReconnect) return;
    const config = getOneBot12Config(api);
    if (!config) {
        api.logger?.warn?.("[onebot12] no config, skip reconnect");
        return;
    }
    try {
        const ws = await connectWs(config);
        setWs(ws);
        api.logger?.info?.("[onebot12] WebSocket connected" + (attempt > 0 ? `（重连成功，第 ${attempt} 次尝试）` : ""));
        setupWsListeners(ws, api, 0);
    } catch (e: any) {
        api.logger?.warn?.(`[onebot12] connect failed: ${e?.message}`);
        scheduleReconnect(api, attempt);
    }
}

export function registerService(api: any): void {
    api.registerService({
        id: "onebot12-ws",
        start: async () => {
            shouldReconnect = true;
            startImageTempCleanup();
            await doConnect(api, 0);
        },
        stop: async () => {
            shouldReconnect = false;
            clearReconnectTimer();
            stopImageTempCleanup();
            stopConnection();
            api.logger?.info?.("[onebot12] service stopped");
        },
    });
}
