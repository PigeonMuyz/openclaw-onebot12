/**
 * OneBot12 TUI 配置向导
 * openclaw onebot12 setup
 */
import {
  cancel as clackCancel,
  confirm as clackConfirm,
  intro as clackIntro,
  isCancel,
  note as clackNote,
  outro as clackOutro,
  select as clackSelect,
  text as clackText,
} from "@clack/prompts";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const OPENCLAW_HOME = join(homedir(), ".openclaw");
const CONFIG_PATH = join(OPENCLAW_HOME, "openclaw.json");

function guardCancel<T>(v: T | symbol): T {
  if (isCancel(v)) {
    clackCancel("已取消。");
    process.exit(0);
  }
  return v as T;
}

export async function runOneBot12Setup(): Promise<void> {
  const endpoint = guardCancel(
    await clackText({
      message: "WebSocket 地址（完整 URL）",
      initialValue: process.env.ONEBOT12_WS_ENDPOINT || "ws://127.0.0.1:8080",
    })
  );

  const authType = guardCancel(
    await clackSelect({
      message: "鉴权类型",
      options: [
        { value: "none", label: "无鉴权" },
        { value: "bearer", label: "Bearer Token（Authorization 头）" },
        { value: "query", label: "Query 参数（URL 附带 access_token）" },
      ],
      initialValue: "none",
    })
  );

  let token = "";
  if (authType !== "none") {
    token = guardCancel(
      await clackText({
        message: "Access Token",
        initialValue: process.env.ONEBOT12_WS_TOKEN || "",
      })
    );
  }

  const platform = guardCancel(
    await clackText({
      message: "平台标识（qq, wechat 等）",
      initialValue: "qq",
    })
  );

  const renderMarkdownToPlain = guardCancel(
    await clackConfirm({
      message: "是否将 Markdown 渲染为纯文本？",
      initialValue: true,
    })
  );

  const longMessageMode = guardCancel(
    await clackSelect({
      message: "长消息处理模式：",
      options: [
        { value: "normal", label: "正常发送" },
        { value: "og_image", label: "生成图片" },
        { value: "forward", label: "合并转发" },
      ],
      initialValue: "normal",
    })
  );

  const longMessageThreshold = guardCancel(
    await clackText({
      message: "长消息阈值（字符数）",
      initialValue: "300",
    })
  );

  let existing: any = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      existing = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    } catch {}
  }
  const prevOb12 = (existing.channels || {}).onebot12;
  const whitelistInitial = Array.isArray(prevOb12?.whitelistUserIds)
    ? prevOb12.whitelistUserIds.join(", ")
    : "";

  const whitelistInput = guardCancel(
    await clackText({
      message: "白名单用户 ID（逗号分隔，留空则所有人可回复）\n  群聊：仅白名单用户 @机器人 时响应\n  私聊：仅白名单用户可触发",
      initialValue: whitelistInitial,
    })
  );

  const privateMessagePrefixInitial = prevOb12?.privateMessagePrefix ?? "";
  const privateMessagePrefixInput = guardCancel(
    await clackText({
      message: "私聊消息前缀符号（如 / 或 #，仅以此符号开头的私聊消息才会处理，留空则不限制）",
      initialValue: privateMessagePrefixInitial,
    })
  );
  const privateMessagePrefix = String(privateMessagePrefixInput || "").trim() || undefined;

  const thresholdNum = parseInt(String(longMessageThreshold).trim(), 10);
  const whitelistIds = String(whitelistInput).trim().split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);

  const channels = existing.channels || {};
  channels.onebot12 = {
    ...(channels.onebot12 || {}),
    endpoint: String(endpoint).trim(),
    authType,
    ...(token?.trim() ? { token: String(token).trim() } : {}),
    platform: String(platform).trim(),
    enabled: true,
    requireMention: true,
    renderMarkdownToPlain,
    longMessageMode,
    longMessageThreshold: Number.isFinite(thresholdNum) ? thresholdNum : 300,
    ...(whitelistIds.length > 0 ? { whitelistUserIds: whitelistIds } : {}),
    ...(privateMessagePrefix ? { privateMessagePrefix } : {}),
  };

  const next = { ...existing, channels };
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), "utf-8");

  clackNote(`配置已保存到 ${CONFIG_PATH}`, "完成");
  clackOutro("运行 openclaw gateway restart 使配置生效");
}
