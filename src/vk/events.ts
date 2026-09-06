import { isRecord } from "../utils/type-guards.js";
import { isOwnerUpdate, type OwnerGateOptions } from "./auth.js";
import type { VkMessage, VkMessageEventObject, VkUpdate } from "./types.js";

export interface NormalizedButtonEvent {
  kind: "button";
  userId: number;
  peerId: number;
  eventId: string;
  payload?: string;
  conversationMessageId?: number;
}

export interface NormalizedMessageEvent {
  kind: "message";
  message: VkMessage;
}

export type NormalizedEvent = NormalizedButtonEvent | NormalizedMessageEvent;

export interface VkEventNormalizerOptions extends OwnerGateOptions {
  /** Size of the event_id dedup window (LRU). */
  maxTrackedEventIds?: number;
}

const DEFAULT_MAX_TRACKED_EVENT_IDS = 256;

/**
 * Turns raw Long Poll updates into typed transport events.
 * Drops, without logging content: unknown types, foreign groups,
 * non-owner senders, and duplicate event ids (redelivery protection,
 * research D6).
 */
export class VkEventNormalizer {
  private readonly options: VkEventNormalizerOptions;
  private readonly seenEventIds = new Set<string>();

  constructor(options: VkEventNormalizerOptions) {
    this.options = {
      maxTrackedEventIds: DEFAULT_MAX_TRACKED_EVENT_IDS,
      ...options,
    };
  }

  normalize(raw: unknown): NormalizedEvent | null {
    if (!isRecord(raw) || typeof raw.type !== "string") {
      return null;
    }

    const update = raw as unknown as VkUpdate;
    if (!isOwnerUpdate(update, this.options)) {
      return null;
    }

    const eventId = typeof raw.event_id === "string" ? raw.event_id : null;
    if (eventId) {
      if (this.seenEventIds.has(eventId)) {
        return null;
      }
      this.remember(eventId);
    }

    if (raw.type === "message_new") {
      return this.normalizeMessageNew(raw);
    }
    if (raw.type === "message_event") {
      return this.normalizeMessageEvent(raw);
    }
    return null;
  }

  private remember(eventId: string): void {
    this.seenEventIds.add(eventId);
    if (this.seenEventIds.size > (this.options.maxTrackedEventIds ?? 0)) {
      const oldest = this.seenEventIds.values().next().value;
      if (oldest !== undefined) {
        this.seenEventIds.delete(oldest);
      }
    }
  }

  private normalizeMessageNew(raw: Record<string, unknown>): NormalizedMessageEvent | null {
    const object = isRecord(raw.object) ? raw.object : null;
    const message = isRecord(object?.message) ? object.message : null;
    if (!message || typeof message.text !== "string" || typeof message.peer_id !== "number") {
      return null;
    }
    const normalized: VkMessage = {
      id: typeof message.id === "number" ? message.id : 0,
      date: typeof message.date === "number" ? message.date : 0,
      peer_id: message.peer_id,
      from_id: typeof message.from_id === "number" ? message.from_id : 0,
      text: message.text,
    };
    if (typeof message.conversation_message_id === "number") {
      normalized.conversation_message_id = message.conversation_message_id;
    }
    if (Array.isArray(message.attachments)) {
      normalized.attachments = message.attachments.map((item) => item);
    }
    return { kind: "message", message: normalized };
  }

  private normalizeMessageEvent(raw: Record<string, unknown>): NormalizedButtonEvent | null {
    const object = isRecord(raw.object) ? raw.object : null;
    if (!object) {
      return null;
    }
    const event = object as unknown as VkMessageEventObject;
    if (typeof event.user_id !== "number" || typeof event.peer_id !== "number") {
      return null;
    }
    if (typeof event.event_id !== "string") {
      return null;
    }
    const button: NormalizedButtonEvent = {
      kind: "button",
      userId: event.user_id,
      peerId: event.peer_id,
      eventId: event.event_id,
    };
    if (typeof event.payload === "string") {
      button.payload = event.payload;
    }
    if (typeof event.conversation_message_id === "number") {
      button.conversationMessageId = event.conversation_message_id;
    }
    return button;
  }
}
