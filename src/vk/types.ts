/** Minimal VK Long Poll update shapes consumed by the transport. */

export interface VkMessageAttachment {
  type: string;
  [key: string]: unknown;
}

export interface VkMessage {
  id: number;
  date: number;
  peer_id: number;
  from_id: number;
  text: string;
  conversation_message_id?: number;
  attachments?: VkMessageAttachment[];
}

export interface VkMessageNewObject {
  message: VkMessage;
  client_info?: Record<string, unknown>;
}

export interface VkMessageEventObject {
  user_id: number;
  peer_id: number;
  event_id: string;
  /** Long Poll delivers a parsed object; callback API delivers a JSON string. */
  payload?: string | Record<string, unknown>;
  conversation_message_id?: number;
}

interface VkUpdateBase {
  type: string;
  group_id?: number | string;
  event_id?: string;
}

export interface VkMessageNewUpdate extends VkUpdateBase {
  type: "message_new";
  object: VkMessageNewObject;
  event_id: string;
}

export interface VkMessageEventUpdate extends VkUpdateBase {
  type: "message_event";
  object: VkMessageEventObject;
  event_id: string;
}

export type VkUpdate =
  | VkMessageNewUpdate
  | VkMessageEventUpdate
  | (VkUpdateBase & Record<string, unknown>);

export interface VkLongPollServer {
  key: string;
  server: string;
  ts: string;
}
