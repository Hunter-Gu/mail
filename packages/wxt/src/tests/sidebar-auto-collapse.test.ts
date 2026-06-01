import { describe, expect, it } from "vitest"

import type { ChatMessage, SidebarState } from "../protocol"
import {
  getAutoOpenSectionKey,
  getReasoningSectionKey,
  getToolSectionKey
} from "../sidebar/auto-collapse"

describe("sidebar auto-collapse sections", () => {
  it("opens only the active reasoning section", () => {
    const message = createAssistantMessage({
      activeSection: { type: "reasoning" },
      reasoning: "Checking the inbox"
    })

    expect(getAutoOpenSectionKey(createState(message))).toBe(
      getReasoningSectionKey(message.id)
    )
  })

  it("moves the open section from reasoning to the active tool", () => {
    const message = createAssistantMessage({
      activeSection: { type: "tool", index: 0 },
      reasoning: "Checking the inbox",
      toolCalls: [
        {
          args: { limit: 4 },
          name: "discover_emails",
          status: "running"
        }
      ]
    })

    expect(getAutoOpenSectionKey(createState(message))).toBe(
      getToolSectionKey(message.id, 0)
    )
  })

  it("collapses completed tools while waiting for the final response", () => {
    const message = createAssistantMessage({
      reasoning: "Checking the inbox",
      toolCalls: [
        {
          args: { limit: 4 },
          name: "discover_emails",
          result: "{}",
          status: "done"
        }
      ]
    })

    expect(getAutoOpenSectionKey(createState(message))).toBeUndefined()
  })

  it("keeps non-final sections closed once final content starts", () => {
    const message = createAssistantMessage({
      activeSection: { type: "tool", index: 0 },
      content: "Done",
      toolCalls: [
        {
          args: { limit: 4 },
          name: "discover_emails",
          status: "running"
        }
      ]
    })

    expect(getAutoOpenSectionKey(createState(message))).toBeUndefined()
  })

  it("can reopen reasoning after a completed tool starts a new reasoning phase", () => {
    const message = createAssistantMessage({
      activeSection: { type: "reasoning" },
      reasoning: "Checking again",
      toolCalls: [
        {
          args: { limit: 4 },
          name: "discover_emails",
          result: "{}",
          status: "done"
        }
      ]
    })

    expect(getAutoOpenSectionKey(createState(message))).toBe(
      getReasoningSectionKey(message.id)
    )
  })
})

function createAssistantMessage(
  overrides: Partial<ChatMessage> = {}
): ChatMessage {
  return {
    content: "",
    createdAt: 1,
    id: "assistant-1",
    role: "assistant",
    ...overrides
  }
}

function createState(message: ChatMessage): SidebarState {
  return {
    gmail: {
      available: true,
      gmailJsReady: true,
      inboxSdkReady: true
    },
    messages: [message],
    status: "running"
  }
}
