import { isRecord } from "../utils/type-guards.js";
import type { VkMessageEventUpdate, VkMessageNewUpdate, VkUpdate } from "./types.js";

export interface OwnerGateOptions {
  groupId: number;
  allowedUserId: number;
  /** Test-only: also accept messages posted by the community itself. */
  selfTest?: boolean;
}

function extractGroupId(update: VkUpdate): number | null {
  const raw = update.group_id;
  if (typeof raw === "number") {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function extractEventUserId(update: VkUpdate): number | null {
  if (update.type === "message_new") {
    const message = (update as VkMessageNewUpdate).object?.message;
    const fromId = isRecord(message) ? message.from_id : undefined;
    return typeof fromId === "number" ? fromId : null;
  }
  if (update.type === "message_event") {
    const userId = (update as VkMessageEventUpdate).object?.user_id;
    return typeof userId === "number" ? userId : null;
  }
  if (update.type === "message_reply") {
    // Community-sent message (self-test path): the sender is the group.
    const fromId = isRecord(update.object) ? update.object.from_id : undefined;
    return typeof fromId === "number" ? fromId : null;
  }
  return null;
}

/**
 * Decides whether an update may be processed at all (FR-001/FR-002):
 * the community must match and the sender must be the allowlisted owner.
 * Never inspects or logs message content — unauthorized updates are
 * dropped silently by the caller.
 */
export function isOwnerUpdate(update: VkUpdate, options: OwnerGateOptions): boolean {
  const groupId = extractGroupId(update);
  if (groupId !== options.groupId) {
    return false;
  }

  const userId = extractEventUserId(update);
  if (userId === null) {
    return false;
  }
  if (userId === options.allowedUserId) {
    return true;
  }
  return options.selfTest === true && userId === -options.groupId;
}
