# OneBot Agent 工具与 CLI

插件通过 WebSocket 与 OneBot（Lagrange.Core / go-cqhttp）通信，提供 **Agent 工具**（供 Cron/脚本/AI 调用）和等价的 **CLI 命令**（供人工或工作流直接调用）。  
AI 或脚本应优先使用 **CLI**，便于复现、调试和文档化。

---

## 前置条件

- **Gateway 已启动**：`openclaw gateway`（或 `openclaw gateway run`）
- OneBot 已运行并连接；若为正向 WS，CLI 会按配置自动建连
- 配置：`openclaw.json` 的 `channels.onebot` 或环境变量 `ONEBOT_WS_*`

---

## 1. 获取群历史消息

**Agent 工具**：`onebot_get_group_msg_history`  
**CLI**：

```bash
openclaw onebot get-group-msg-history --group-id <群号> [--hours <N>] [--count 50] [--message-seq <序号>]
```

- 指定 **`--hours N`**：获取**从现在到过去 N 小时**内的消息（内部按时间范围分页拉取），例如 `--hours 24` 即过去 24 小时。
- 不指定 `--hours`：按单页返回，始终**从旧到新**；分页时用上一批最早一条的 `message_seq` 作为 `--message-seq`。

| 参数 | 说明 |
|------|------|
| `--group-id` | 群号（必填） |
| `--hours` | 获取最近 N 小时内的消息（可选；指定后按时间范围拉取） |
| `--count` | 条数，默认 50（未指定 --hours 时生效） |
| `--message-seq` | 起始消息序号（可选，分页用，未指定 --hours 时生效） |

示例：

```bash
openclaw onebot get-group-msg-history --group-id 123456789
openclaw onebot get-group-msg-history --group-id 123456789 --hours 24
openclaw onebot get-group-msg-history --group-id 123456789 --hours 1 --limit 500
```

---

## 2. 按名字模糊搜索群成员（查 QQ 号）

**Agent 工具**：`onebot_search_group_member`  
**CLI**：

```bash
openclaw onebot search-group-member --group-id <群号> --name <名字>
```

| 参数 | 说明 |
|------|------|
| `--group-id` | 群号（必填） |
| `--name` | 要搜的名字（群名片或昵称，模糊匹配） |

输出：匹配到的 QQ 与展示名。

示例：

```bash
openclaw onebot search-group-member --group-id 123456789 --name 小明
```

---

## 3. 发送文本

**Agent 工具**：`onebot_send_text`  
**CLI**（推荐使用主命令）：

```bash
openclaw message send --channel onebot --target group:<群号> --message "内容"
openclaw message send --channel onebot --target user:<QQ号> --message "内容"
```

---

## 4. 发送图片

**Agent 工具**：`onebot_send_image`  
**CLI**：

```bash
openclaw message send --channel onebot --target group:<群号> --media "file:///path/to.png"
openclaw message send --channel onebot --target user:<QQ号> --media "https://example.com/pic.jpg"
```

---

## 5. 上传文件到群/私聊

**Agent 工具**：`onebot_upload_file`  
**CLI**：

```bash
openclaw onebot upload-file --target group:<群号> --file <本地绝对路径> --name <显示文件名>
openclaw onebot upload-file --target user:<QQ号> --file <本地绝对路径> --name <显示文件名>
```

---

## 6. 执行脚本（Cron 等）

**Agent 工具**：`onebot_run_script`  
**CLI**：无直接一对一命令，可由 Cron 或工作流调用脚本，脚本内使用上述 CLI 或 `onebotClient` API。

---

## 使用建议

- **AI / 自动化**：优先使用上述 **CLI 命令**，便于在 Skill 中写明「如何调用」、可复现。
- **Cron / 内置任务**：在 `openclaw.json` 的 `cronJobs` 中配置 `script`，脚本内通过 `onebotClient` 或子进程调用 CLI。
- **临时查询**：直接运行 `openclaw onebot search-group-member ...` 等。
