/**
 * OneBot 12 Channel 插件入口
 */

import { OneBot12ChannelPlugin } from "./channel.js";
import { registerService } from "./service.js";
import { runOneBot12Setup } from "./setup.js";

export default function activate(api: any): void {
    (globalThis as any).__onebot12Api = api;

    api.registerChannelPlugin?.(OneBot12ChannelPlugin);
    registerService(api);

    // CLI 命令
    api.registerCliCommand?.({
        command: "onebot12 setup",
        description: "配置 OneBot 12 通道",
        handler: async () => {
            await runOneBot12Setup();
        },
    });

    api.logger?.info?.("[onebot12] plugin loaded");
}
