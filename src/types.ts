/**
 * OneBot v12 协议类型定义
 */

export interface OneBot12MessageSegment {
  type: string;
  data: Record<string, any>;
}

export interface OneBot12Message {
  id: string;
  time: number;
  type: "message";
  detail_type: "private" | "group";
  sub_type?: string;
  self: { platform: string; user_id: string };
  user_id?: string;
  group_id?: string;
  message: OneBot12MessageSegment[];
  message_id: string;
  alt_message?: string;
  [key: string]: unknown;
}

export interface OneBot12AccountConfig {
  accountId?: string;
  endpoint: string;
  token?: string;
  authType?: "none" | "bearer" | "query";
  selfId?: string;
  platform?: string;
  enabled?: boolean;
}
