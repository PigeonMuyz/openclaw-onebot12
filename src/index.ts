/**
 * OneBot 12 Channel 插件入口
 */

import { OneBot12ChannelPlugin } from "./channel.js";
import { registerService } from "./service.js";

export default function register(api: any): void {
    (globalThis as any).__onebot12Api = api;
    (globalThis as any).__onebot12GatewayConfig = api.config;

    api.registerChannel({ plugin: OneBot12ChannelPlugin });

    if (typeof api.registerCli === "function") {
        api.registerCli(
            (ctx: any) => {
                const prog = ctx.program;
                if (prog && typeof prog.command === "function") {
                    const onebot12 = prog.command("onebot12").description("OneBot v12 渠道配置");
                    onebot12.command("setup").description("交互式配置 OneBot v12 连接参数").action(async () => {
                        const { runOneBot12Setup } = await import("./setup.js");
                        await runOneBot12Setup();
                    });
                }
            },
            { commands: ["onebot12"] }
        );
    }

    registerService(api);

    api.logger?.info?.("[onebot12] plugin loaded");
}
