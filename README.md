<div align="center">

# openclaw-onebot12

[OpenClaw](https://openclaw.ai) 的 **OneBot v12 协议**渠道插件。

支持 QQ（Walle-Q 等）、微信及其他实现了 OneBot v12 协议的 Bot 框架。

[![npm version](https://img.shields.io/npm/v/@pigeonmuyz/openclaw-onebot12?style=flat-square)](https://www.npmjs.com/package/@pigeonmuyz/openclaw-onebot12)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen?style=flat-square)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue?style=flat-square)](https://www.typescriptlang.org/)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-Plugin-9cf?style=flat-square)](https://openclaw.ai)

</div>

---

## 特性

### 🧑 用户导向会话

本插件采用**用户导向**的会话管理，而非传统的消息渠道导向。同一用户无论在群聊中 @bot 还是私聊 bot，都共享同一个 AI 对话上下文：

```
群聊 A @bot → 上下文 User123    （共享记忆）
私聊 bot   → 上下文 User123    （同一上下文）
```

AI 的回复仍然发送到正确位置——群消息回群，私聊回私聊。

### 🔒 消息过滤

| 场景 | 规则 |
|------|------|
| **群聊** | 白名单非空时，仅白名单用户 @bot 才处理；非白名单用户静默忽略 |
| **私聊** | 白名单非空时，非白名单用户回复"权限不足"；有前缀符号时消息必须以前缀开头 |

### 🔧 OneBot v12 协议适配

| 特性 | 说明 |
|------|------|
| 发送消息 | `send_message` + `detail_type`（统一 API） |
| @检测 | `mention` 消息段（替代 v11 的 `at`） |
| 事件类型 | `type` + `detail_type`（替代 v11 的 `post_type` + `message_type`） |
| ID 类型 | 字符串（替代 v11 的数字） |
| 鉴权 | 支持 `bearer`（Authorization 头）和 `query`（URL 参数）两种模式 |

---

## 安装

```bash
openclaw plugins install @pigeonmuyz/openclaw-onebot12
openclaw onebot12 setup
```

## 配置向导

运行 `openclaw onebot12 setup` 后依次配置：

1. WebSocket 地址（如 `ws://127.0.0.1:8080`）
2. 鉴权类型（none / bearer / query）
3. Access Token（鉴权时填写）
4. 平台标识（qq / wechat）
5. Markdown 渲染、长消息模式
6. 白名单用户 ID
7. 私聊消息前缀符号

## 配置示例

```json
{
  "channels": {
    "onebot12": {
      "endpoint": "ws://127.0.0.1:8080",
      "authType": "bearer",
      "token": "your_token_here",
      "platform": "qq",
      "whitelistUserIds": ["1193466151", "2575183654"],
      "privateMessagePrefix": "/",
      "requireMention": true,
      "renderMarkdownToPlain": true,
      "longMessageMode": "normal",
      "longMessageThreshold": 300
    }
  }
}
```

## 功能

- ✅ 私聊/群聊消息处理（用户导向共享上下文）
- ✅ 群聊 @bot 触发回复（使用 `mention` 消息段检测）
- ✅ 白名单 + 私聊前缀符号过滤
- ✅ 自动获取引用上下文（v12 `reply` 段，部分实现可能不支持）
- ✅ 自动合并转发长消息
- ✅ 长消息生成图片（og_image 模式）
- ✅ 支持文件、图像发送
- ✅ 配置向导（`openclaw onebot12 setup`）

## 使用

1. 安装并配置（`openclaw onebot12 setup`）
2. 重启 Gateway：`openclaw gateway restart`
3. 在群聊中 @bot 或私聊 bot 发消息

## 参考项目

本项目基于 [@kirigaya/openclaw-onebot](https://github.com/LSTM-Kirigaya/openclaw-onebot)（OneBot v11 版本）改造为 v12 协议适配。感谢原作者 [LSTM-Kirigaya](https://github.com/LSTM-Kirigaya) 的开源贡献。

- [原版 openclaw-onebot (v11)](https://github.com/LSTM-Kirigaya/openclaw-onebot) — 原作者 [LSTM-Kirigaya](https://github.com/LSTM-Kirigaya)
- [OneBot 12 协议标准](https://12.onebot.dev/)
- [OpenClaw](https://openclaw.ai)

## License

MIT © [PigeonMuyz](https://github.com/PigeonMuyz)
