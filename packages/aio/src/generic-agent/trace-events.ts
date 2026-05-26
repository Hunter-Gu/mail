import type { LanguageModelUsage } from "ai"

export enum TraceEventType {
  InputMessage = "message",
  Reasoning = "reasoning",
  Text = "text",
  ToolCall = "tool-call",
  ToolResult = "tool-result",
  ToolError = "tool-error",
  TokenUsage = "token-usage"
}

export interface TraceMetadata {
  readonly timestamp: Date
  readonly agentName?: string
}

export type TracePayload =
  | {
      readonly type: TraceEventType.InputMessage
      readonly content: string
    }
  | {
      readonly type: TraceEventType.Reasoning | TraceEventType.Text
      readonly content: string
    }
  | {
      readonly type: TraceEventType.ToolCall
      readonly toolName: string
      readonly input: Record<string, unknown>
    }
  | {
      readonly type: TraceEventType.ToolResult
      readonly toolName: string
      readonly output: string
    }
  | {
      readonly type: TraceEventType.ToolError
      readonly toolName: string
      readonly error: unknown
    }
  | {
      readonly type: TraceEventType.TokenUsage
      readonly usage: LanguageModelUsage
    }

export type TraceEvent = TraceMetadata & TracePayload
