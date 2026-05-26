import { Trace, TraceEvent } from "aio"
import type { LanguageModel } from "ai"

export type ContextModels = {
  main: LanguageModel
  search: LanguageModel
  summary: LanguageModel
}

export type Context = {
  models: ContextModels
  trace?: Trace<TraceEvent>[]
  memory: {
    read: () => Promise<string>
    write: (content: string) => Promise<void>
  }
  gmail: GmailClient

  askContinue?: () => boolean | Promise<boolean>

  /** Called for each text chunk emitted during streaming. `done` is true on the final (empty) flush. */
  onTextDelta?: (delta: string, done: boolean) => void
  /** Called for each reasoning/thinking chunk emitted during streaming. `done` is true on the final flush. */
  onReasoningDelta?: (delta: string, done: boolean) => void
  /** Called when a tool is about to be invoked. */
  onToolCall?: (name: string, args: Record<string, unknown>) => void
  /** Called after a tool returns its result. */
  onToolResult?: (name: string, result: string) => void
}

type MaybePromise<T> = T | Promise<T>

export type GmailClientError = {
  error: string
  stderr?: string
  nonRetryable?: boolean
  userNotified?: boolean
  step?: string
  reason?: string
}

export type LabelId = string
export type LabelName = string

/**
 * A map of Gmail labels:
 * - Key: The unique Gmail label ID (e.g., "INBOX", "UNREAD", "Label_1")
 * - Value: The human-readable label name (e.g., "Inbox", "Unread", "Work")
 */
export type LabelMap = Map<LabelId, LabelName>

export type GmailLabel = {
  id: string
  name: string
  type?: "system" | "user" | string
  messageListVisibility?: string
  labelListVisibility?: string
}

export type GmailMessageRef = {
  id: string
  threadId: string
}

export type GmailListMessagesResponse = {
  messages?: GmailMessageRef[]
  nextPageToken?: string
  resultSizeEstimate?: number
}

export type GmailListLabelsResponse = {
  labels?: GmailLabel[]
}

export type GmailHeader = {
  name: string
  value: string
}

export type GmailMessagePartBody = {
  attachmentId?: string
  size?: number
  data?: string
}

export type GmailMessagePart = {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: GmailMessagePartBody
  parts?: GmailMessagePart[]
}

export type GmailMessage = {
  id?: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  historyId?: string
  internalDate?: string
  payload?: GmailMessagePart
  sizeEstimate?: number
  raw?: string
}

export type GmailClientResult<T> = T | GmailClientError

export interface GmailClient {
  listMessages(
    query: string | undefined,
    offset: number,
    limit: number
  ): MaybePromise<GmailClientResult<GmailListMessagesResponse>>

  getMessage: (
    messageId: string
  ) => MaybePromise<GmailClientResult<GmailMessage> | null>

  getMessageMetadata: (
    messageId: string
  ) => MaybePromise<GmailClientResult<GmailMessage> | null>

  listLabels: () => MaybePromise<GmailClientResult<GmailListLabelsResponse>>

  updateLabels: (
    messageId: string,
    labelsToAdd?: string[],
    labelsToRemove?: string[]
  ) => MaybePromise<GmailClientResult<GmailMessage>>
}

export function isGmailClientError(value: unknown): value is GmailClientError {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "error" in value &&
    typeof value.error === "string"
  )
}
