import { storage } from "#imports"
import type {
  Context,
  GmailClient,
  GmailClientError,
  GmailListLabelsResponse,
  GmailListMessagesResponse,
  GmailMessage
} from "agent"

import {
  createMessage,
  isGmailClientError,
  type BackgroundEvent,
  type GmailBridgeMessage,
  type GmailBridgeRequest,
  type GmailBridgeResponse,
  type GmailSnapshot,
  type SidebarState
} from "../protocol"
import { createSessionId } from "log-server"
import { clearGmailAgentRunner, promptGmailAgent } from "./agent-runner"
import { getModels } from "./models"
import { trace, getLogTrace } from "./trace"

const initialGmailSnapshot: GmailSnapshot = {
  available: false,
  inboxSdkReady: false,
  gmailJsReady: false
}

let resolveAskContinue: ((value: boolean) => void) | undefined
let sessionId = createSessionId()

export const state: SidebarState = {
  status: "ready",
  messages: [createMessage("assistant", "Ready.", Date.now())],
  gmail: initialGmailSnapshot
}

export function getState(): SidebarState {
  return {
    ...state,
    messages: [...state.messages],
    gmail: { ...state.gmail }
  }
}

export async function publishState(): Promise<void> {
  const event: BackgroundEvent = {
    type: "state:changed",
    state: getState()
  }

  await browser.runtime.sendMessage(event).catch(() => undefined)
}

export async function resetChat(): Promise<SidebarState> {
  clearGmailAgentRunner()
  sessionId = createSessionId()
  state.messages = [createMessage("assistant", "Ready.")]
  state.status = "ready"
  state.error = undefined
  await publishState()
  return getState()
}

export async function updateGmailSnapshot(
  snapshot: GmailSnapshot
): Promise<SidebarState> {
  state.gmail = snapshot
  await publishState()
  return getState()
}

export async function sendUserMessage(
  text: string,
  tabId?: number
): Promise<SidebarState> {
  const trimmed = text.trim()
  if (!trimmed) return getState()

  state.messages.push(createMessage("user", trimmed))

  const assistantMsg = createMessage("assistant", "")
  state.messages.push(assistantMsg)

  state.status = "running"
  state.error = undefined
  await publishState()

  try {
    await refreshGmailSnapshot(tabId)
    const ctx = createContext(
      tabId,
      (delta) => {
        assistantMsg.content += delta
        assistantMsg.activeSection = undefined
        void publishState()
      },
      (delta) => {
        if (delta) {
          assistantMsg.reasoning = (assistantMsg.reasoning || "") + delta
          assistantMsg.activeSection = { type: "reasoning" }
          void publishState()
        }
      },
      (name, args) => {
        if (!assistantMsg.toolCalls) {
          assistantMsg.toolCalls = []
        }
        assistantMsg.toolCalls.push({
          name,
          args,
          status: "running"
        })
        assistantMsg.activeSection = {
          type: "tool",
          index: assistantMsg.toolCalls.length - 1
        }
        void publishState()
      },
      (name, result) => {
        if (assistantMsg.toolCalls) {
          const toolIndex = findLastRunningToolIndex(
            assistantMsg.toolCalls,
            name
          )
          const toolCall = assistantMsg.toolCalls[toolIndex]
          if (toolCall) {
            toolCall.result = result
            toolCall.status = "done"
          }
          if (
            assistantMsg.activeSection?.type === "tool" &&
            assistantMsg.activeSection.index === toolIndex
          ) {
            assistantMsg.activeSection = undefined
          }
        }
        void publishState()
      }
    )

    const response = await promptGmailAgent(ctx, tabId, trimmed)
    assistantMsg.content = response
    assistantMsg.activeSection = undefined
    state.status = "ready"
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    state.status = "error"
    state.error = message
    assistantMsg.activeSection = undefined
    assistantMsg.content = (
      assistantMsg.content + `\n\nError: ${message}`
    ).trim()
  }

  await publishState()
  return getState()
}

function findLastRunningToolIndex(
  toolCalls: { name: string; status: string }[],
  name: string
): number {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const toolCall = toolCalls[index]
    if (toolCall?.name === name && toolCall.status === "running") {
      return index
    }
  }
  return -1
}



export function handleContinue(approve: boolean): void {
  if (resolveAskContinue) {
    resolveAskContinue(approve)
    resolveAskContinue = undefined
    state.status = "running"
    void publishState()
  }
}

function createContext(
  tabId: number | undefined,
  onTextDelta: (delta: string) => void,
  onReasoningDelta: (delta: string) => void,
  onToolCall: (name: string, args: Record<string, unknown>) => void,
  onToolResult: (name: string, result: string) => void
): Context {
  return {
    models: getModels(),
    trace: [trace, getLogTrace(sessionId)],
    gmail: createBackgroundGmailClient(tabId),
    memory: {
      read: async () => {
        return (await storage.getItem<string>("sync:agent_memory")) || ""
      },
      write: async (content) => {
        const current =
          (await storage.getItem<string>("sync:agent_memory")) || ""
        const updated = [current, content.trim()].filter(Boolean).join("\n\n")
        await storage.setItem("sync:agent_memory", updated)
      }
    },
    onTextDelta: (delta, done) => {
      onTextDelta(delta)
    },
    onReasoningDelta: (delta, done) => {
      onReasoningDelta(delta)
    },
    onToolCall: (name, args) => {
      onToolCall(name, args)
    },
    onToolResult: (name, result) => {
      onToolResult(name, result)
    },
    askContinue: () => {
      state.status = "paused"
      void publishState()
      return new Promise<boolean>((resolve) => {
        resolveAskContinue = resolve
      })
    }
  }
}

export function createBackgroundGmailClient(tabId?: number): GmailClient {
  return {
    listMessages: async (query, offset, limit) => {
      const response = await requestGmail(tabId, {
        type: "messages:list",
        query,
        offset,
        limit
      })
      return isMessageList(response)
        ? response
        : toClientError(response, "Invalid Gmail message list response.")
    },
    getMessage: async (messageId) => {
      const response = await requestGmail(tabId, {
        type: "message:get",
        messageId
      })
      if (isMessage(response) && "step" in response) {
        state.gmail.lastMessageStep = response.step as string
        void publishState()
      }
      return isMessage(response)
        ? response
        : toClientError(response, "Invalid Gmail message response.")
    },
    getMessageMetadata: async (messageId) => {
      const response = await requestGmail(tabId, {
        type: "message:get",
        messageId,
        metadataOnly: true
      })
      if (isMessage(response) && "step" in response) {
        state.gmail.lastMessageStep = response.step as string
        void publishState()
      }
      return isMessage(response)
        ? response
        : toClientError(response, "Invalid Gmail metadata response.")
    },
    listLabels: async () => {
      const response = await requestGmail(tabId, { type: "labels:list" })
      return isLabelList(response)
        ? response
        : toClientError(response, "Invalid Gmail label list response.")
    },
    updateLabels: async (messageId, addLabelIds, removeLabelIds) => {
      const response = await requestGmail(tabId, {
        type: "labels:update",
        messageId,
        addLabelIds,
        removeLabelIds
      })
      return isMessage(response)
        ? response
        : toClientError(response, "Invalid Gmail label update response.")
    }
  }
}

export async function handleDebugGmailRequest(
  request: GmailBridgeRequest
): Promise<GmailBridgeResponse> {
  return requestGmail(undefined, request)
}

async function refreshGmailSnapshot(tabId?: number): Promise<void> {
  const snapshot = await requestGmail(tabId, { type: "snapshot:get" })
  if (!isGmailClientError(snapshot)) {
    state.gmail = snapshot as GmailSnapshot
  }
}

async function requestGmail(
  preferredTabId: number | undefined,
  request: GmailBridgeRequest
): Promise<GmailBridgeResponse> {
  const tabId = preferredTabId ?? (await findActiveGmailTabId())
  if (tabId === undefined) {
    return { error: "No active Gmail tab is available." }
  }

  const message: GmailBridgeMessage = {
    type: "gmail:request",
    request
  }
  try {
    const response = await browser.tabs.sendMessage(tabId, message)
    return response
  } catch (err) {
    return { error: `Failed to communicate with Gmail page: ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function findActiveGmailTabId(): Promise<number | undefined> {
  // 1. Try active tab in current window
  let tabs = await browser.tabs.query({
    active: true,
    currentWindow: true,
    url: "https://mail.google.com/*"
  }).catch(() => [])
  if (tabs.length > 0 && tabs[0].id !== undefined) {
    return tabs[0].id
  }

  // 2. Try active tab in ANY window (handles when DevTools has focus)
  tabs = await browser.tabs.query({
    active: true,
    url: "https://mail.google.com/*"
  }).catch(() => [])
  if (tabs.length > 0 && tabs[0].id !== undefined) {
    return tabs[0].id
  }

  // 3. Try ANY Gmail tab in the current window (even if not active)
  tabs = await browser.tabs.query({
    currentWindow: true,
    url: "https://mail.google.com/*"
  }).catch(() => [])
  if (tabs.length > 0 && tabs[0].id !== undefined) {
    return tabs[0].id
  }

  // 4. Try ANY Gmail tab in ANY window
  tabs = await browser.tabs.query({
    url: "https://mail.google.com/*"
  }).catch(() => [])
  if (tabs.length > 0 && tabs[0].id !== undefined) {
    return tabs[0].id
  }

  return undefined
}



function isMessageList(
  value: GmailBridgeResponse
): value is GmailListMessagesResponse {
  return isObject(value) && "messages" in value
}

function isLabelList(
  value: GmailBridgeResponse
): value is GmailListLabelsResponse {
  return isObject(value) && "labels" in value
}

function isMessage(value: GmailBridgeResponse): value is GmailMessage {
  return (
    isObject(value) &&
    ("payload" in value || "id" in value || "threadId" in value)
  )
}

function toClientError(
  response: GmailBridgeResponse,
  fallback: string
): GmailClientError {
  return isGmailClientError(response) ? response : { error: fallback }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
