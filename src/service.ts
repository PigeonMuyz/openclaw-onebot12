/**
 * OneBot 12 WebSocket 服务
 */

import type { OneBot12Message } from "./types.js";
import { getOneBot12Config } from "./config.js";
import { connectWs, setWs, stopConnection, handleEchoResponse, startImageTempCleanup, stopImageTempCleanup } from "./connection.js";
import { processInboundMessage } from "./handlers/process-inbound.js";

export function registerService(api: any): void {
    api.registerService({
        id: "onebot12-ws",
        start: async () => {
            const config = getOneBot12Config(api);
            if (!config) {
                api.logger?.warn?.("[onebot12] no config, service will not connect");
                return;
            }

            try {
                const ws = await connectWs(config);
                setWs(ws);
                api.logger?.info?.("[onebot12] WebSocket connected");

                startImageTempCleanup();

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
                    api.logger?.info?.("[onebot12] WebSocket closed");
                });

                ws.on("error", (e: Error) => {
                    api.logger?.error?.(`[onebot12] WebSocket error: ${e?.message}`);
                });
            } catch (e: any) {
                api.logger?.error?.(`[onebot12] start failed: ${e?.message}`);
            }
        },
        stop: async () => {
            stopImageTempCleanup();
            stopConnection();
            api.logger?.info?.("[onebot12] service stopped");
        },
    });
}
