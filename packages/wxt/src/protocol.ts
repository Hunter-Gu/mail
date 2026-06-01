import type {
  GmailClientError,
  GmailListLabelsResponse,
  GmailListMessagesResponse,
  GmailMessage
} from "agent"

export type ChatRole = "user" | "assistant"

export type ToolCallState = {
  name: string
  args: Record<string, unknown>
  result?: string
  status: "running" | "done" | "error"
}

export type ChatActiveSection =
  | { type: "reasoning" }
  | { type: "tool"; index: number }

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  reasoning?: string
  toolCalls?: ToolCallState[]
  activeSection?: ChatActiveSection
  createdAt: number
}

export type ChatStatus = "ready" | "running" | "paused" | "error"

export type GmailSnapshot = {
  available: boolean
  accountEmail?: string
  page?: string
  threadId?: string
  emailId?: string
  subject?: string
  visibleMessageCount?: number
  inboxSdkReady: boolean
  gmailJsReady: boolean
  error?: string
  lastMessageStep?: string
}

export type SidebarState = {
  status: ChatStatus
  messages: ChatMessage[]
  gmail: GmailSnapshot
  error?: string
}

export type BackgroundRequest =
  | { type: "state:get" }
  | { type: "chat:send"; text: string }
  | { type: "chat:reset" }
  | { type: "chat:continue"; approve: boolean }
  | { type: "gmail:ready"; snapshot: GmailSnapshot }
  | { type: "gmail:debug_request"; request: GmailBridgeRequest }

export type BackgroundEvent = {
  type: "state:changed"
  state: SidebarState
}

export type GmailBridgeRequest =
  | { type: "snapshot:get" }
  | { type: "messages:list"; query?: string; offset: number; limit: number }
  | { type: "message:get"; messageId: string; metadataOnly?: boolean }
  | {
      type: "labels:update"
      messageId: string
      addLabelIds?: string[]
      removeLabelIds?: string[]
    }
  | {
      type: "labels:batchUpdate"
      messageIds: string[]
      addLabelIds?: string[]
      removeLabelIds?: string[]
    }
  | {
      type: "labels:list"
      filter?: "all" | "system" | "user"
      query?: string
    }

export type GmailBatchUpdateLabelsResponse = {
  updatedIds?: string[]
  messages?: GmailMessage[]
  failed?: Array<{
    id: string
    error: string
  }>
  step?: string
  reason?: string
}

export type GmailBridgeMessage = {
  type: "gmail:request"
  request: GmailBridgeRequest
}

export type GmailBridgeResponse =
  | GmailSnapshot
  | GmailListMessagesResponse
  | GmailListLabelsResponse
  | GmailBatchUpdateLabelsResponse
  | GmailMessage
  | GmailClientError

export type StateResponse = {
  state: SidebarState
}

export function createMessage(
  role: ChatRole,
  content: string,
  now = Date.now()
): ChatMessage {
  return {
    id: `${role}-${now}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: now
  }
}

export function isGmailClientError(
  value: unknown
): value is GmailClientError {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "error" in value &&
    typeof value.error === "string"
  )
}
