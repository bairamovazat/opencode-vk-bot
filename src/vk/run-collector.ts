import { isRecord } from "../utils/type-guards.js";
import { logger } from "../utils/logger.js";
import { subscribeToEvents } from "../opencode/events.js";

export interface RunResult {
  sessionId: string;
  text: string;
}

export interface ToolActivity {
  toolCount: number;
  lastTool?: string;
}

export interface PermissionAsked {
  requestId: string;
  sessionId: string;
  permission: string;
  patterns: string[];
}

export interface QuestionAsked {
  requestId: string;
  sessionId: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
  }>;
}

export interface RunCollectorDeps {
  /** Called when the agent run finishes with the assembled assistant text. */
  onComplete: (result: RunResult) => void | Promise<void>;
  /** Called on run-level backend errors (session.error). */
  onError: (sessionId: string, message: string) => void | Promise<void>;
  /** Called on tool activity while the run is in flight (US2 status). */
  onActivity?: (activity: ToolActivity) => void | Promise<void>;
  /** Permission prompt from the agent (US3). */
  onPermission?: (asked: PermissionAsked) => void | Promise<void>;
  /** Question prompt from the agent (US3). */
  onQuestion?: (asked: QuestionAsked) => void | Promise<void>;
}

interface TextPartState {
  content: string;
  order: number;
}

interface RunState {
  sessionId: string;
  directory: string;
  parts: Map<string, TextPartState>;
  partOrder: Map<string, number>;
  nextOrder: number;
  /** messageID -> role, learned from message.updated events. */
  messageRoles: Map<string, string>;
  /** Part keys proven to be `text` via part.updated (delta events may omit type). */
  knownTextParts: Set<string>;
}

/**
 * Collects one agent run's assistant text from the OpenCode SSE stream and
 * reports the final message.VK transport replacement for the upstream
 * Telegram-bound summary aggregator (research D4: VK cannot edit messages,
 * so US1 delivers the final text; US2 adds the live status layer).
 */
export class VkRunCollector {
  private readonly deps: RunCollectorDeps;
  private run: RunState | null = null;
  private toolCount = 0;

  constructor(deps: RunCollectorDeps) {
    this.deps = deps;
  }

  /**
   * Marks the collector active for a session and (re)subscribes the
   * OpenCode event stream for its directory. The subscription is shared
   * per directory inside opencode/events.ts; the callback below simply
   * replaces the previous one.
   *
   * IMPORTANT: subscribeToEvents is a long-running listener (it resolves
   * only when the stream stops), so it is fired, not awaited — awaiting it
   * would freeze the caller for the entire lifetime of the stream.
   */
  async begin(sessionId: string, directory: string): Promise<void> {
    this.run = {
      sessionId,
      directory,
      parts: new Map(),
      partOrder: new Map(),
      nextOrder: 0,
      messageRoles: new Map(),
      knownTextParts: new Set(),
    };
    subscribeToEvents(directory, (event) => this.processEvent(event)).catch((error) => {
      logger.error("[VkRunCollector] Event subscription failed", error);
    });
  }

  isActive(): boolean {
    return this.run !== null;
  }

  abort(): void {
    this.run = null;
  }

  processEvent(event: unknown): void {
    const run = this.run;
    if (!run || !isRecord(event) || typeof event.type !== "string") {
      return;
    }
    const properties = isRecord(event.properties) ? event.properties : {};
    const type = event.type;

    if (type === "message.updated") {
      const info = isRecord(properties.info) ? properties.info : null;
      const messageID = info && typeof info.id === "string" ? info.id : null;
      const role = info && typeof info.role === "string" ? info.role : null;
      if (messageID && role && run.sessionId === (info?.sessionID ?? run.sessionId)) {
        run.messageRoles.set(messageID, role);
      }
      return;
    }

    if (type === "message.part.updated") {
      const part = isRecord(properties.part) ? properties.part : null;
      if (!part || part.sessionID !== run.sessionId) {
        return;
      }
      if (part.type === "tool") {
        this.toolCount += 1;
        const activity: ToolActivity = { toolCount: this.toolCount };
        if (typeof part.tool === "string") {
          activity.lastTool = part.tool;
        }
        void this.deps.onActivity?.(activity);
        return;
      }
      if (part.type !== "text" || part.synthetic === true) {
        return;
      }
      const partId = typeof part.id === "string" ? part.id : "text";
      const messageId = typeof part.messageID === "string" ? part.messageID : undefined;
      const partKey = messageId ? `${messageId}:${partId}` : partId;
      run.knownTextParts.add(partKey);
      const state = this.ensurePart(partId, messageId);
      if (typeof part.text === "string") {
        state.content = part.text;
      }
      const delta = properties.delta;
      if (typeof delta === "string" && delta.length > 0 && typeof part.text !== "string") {
        state.content += delta;
      }
      return;
    }

    if (type === "message.part.delta") {
      const part = isRecord(properties.part) ? properties.part : null;
      const sessionID = (part?.sessionID as string | undefined) ?? properties.sessionID;
      if (sessionID !== run.sessionId) {
        return;
      }
      const partType = (part?.type as string | undefined) ?? properties.type;
      const messageID = (part?.messageID as string | undefined) ?? properties.messageID;
      if (typeof messageID !== "string") {
        return;
      }
      const partID =
        (part?.id as string | undefined) ?? (properties.partID as string | undefined) ?? "text";
      const partKey = `${messageID}:${partID}`;
      // Delta events often omit the part type; accept them only for parts
      // already proven to be text, so reasoning deltas never leak in.
      if (partType === "text") {
        run.knownTextParts.add(partKey);
      } else if (partType !== undefined || !run.knownTextParts.has(partKey)) {
        return;
      }
      const delta = properties.delta;
      if (typeof delta !== "string" || delta.length === 0) {
        return;
      }
      const state = this.ensurePart(partID, messageID);
      state.content += delta;
      return;
    }

    if (type === "permission.asked") {
      const id = typeof properties.id === "string" ? properties.id : null;
      const sessionID = typeof properties.sessionID === "string" ? properties.sessionID : null;
      if (!id || sessionID !== run.sessionId) {
        return;
      }
      const permission =
        typeof properties.permission === "string" ? properties.permission : "unknown";
      const patterns = Array.isArray(properties.patterns)
        ? properties.patterns.filter((p): p is string => typeof p === "string")
        : [];
      void this.deps.onPermission?.({
        requestId: id,
        sessionId: sessionID,
        permission,
        patterns,
      });
      return;
    }

    if (type === "question.asked") {
      const id = typeof properties.id === "string" ? properties.id : null;
      const sessionID = typeof properties.sessionID === "string" ? properties.sessionID : null;
      if (!id || sessionID !== run.sessionId) {
        return;
      }
      const questions = Array.isArray(properties.questions)
        ? properties.questions.filter(isRecord).map((q) => ({
            question: typeof q.question === "string" ? q.question : "",
            header: typeof q.header === "string" ? q.header : "",
            options: Array.isArray(q.options)
              ? q.options.filter(isRecord).map((o) => ({
                  label: typeof o.label === "string" ? o.label : "",
                  description: typeof o.description === "string" ? o.description : "",
                }))
              : [],
          }))
        : [];
      void this.deps.onQuestion?.({ requestId: id, sessionId: sessionID, questions });
      return;
    }

    if (type === "session.idle") {
      if (properties.sessionID === run.sessionId) {
        void this.finish();
      }
      return;
    }

    if (type === "session.error") {
      if (properties.sessionID === run.sessionId) {
        const error = isRecord(properties.error) ? properties.error : {};
        const message =
          typeof error.message === "string" ? error.message : "unknown session error";
        logger.error("[VkRunCollector] Session error", { sessionId: run.sessionId, message });
        this.run = null;
        void this.deps.onError(run.sessionId, message);
      }
    }
  }

  private ensurePart(partId: string, messageId?: string): TextPartState {
    const run = this.run as RunState;
    const key = messageId ? `${messageId}:${partId}` : partId;
    let state = run.parts.get(key);
    if (!state) {
      state = { content: "", order: run.nextOrder };
      run.nextOrder += 1;
      run.parts.set(key, state);
    }
    return state;
  }

  private async finish(): Promise<void> {
    const run = this.run;
    if (!run) {
      return;
    }
    this.run = null;
    this.toolCount = 0;

    const ordered = [...run.parts.entries()]
      .filter(([key]) => {
        const [messageID] = key.split(":");
        // User-message echoes must never leak into the assistant reply.
        return run.messageRoles.get(messageID ?? "") !== "user";
      })
      .sort((a, b) => a[1].order - b[1].order);
    const text = ordered
      .map(([, state]) => state.content)
      .filter((content) => content.trim().length > 0)
      .join("\n\n");

    await this.deps.onComplete({ sessionId: run.sessionId, text });
  }
}
