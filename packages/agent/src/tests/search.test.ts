import { describe, expect, it, vi } from "vitest"

import { buildSearchPrompt, discoverEmailsTool } from "../search"
import type { Context, GmailMessage } from "../types"

function message(id: string): GmailMessage {
  return { id, threadId: id, labelIds: [], snippet: `Snippet ${id}` }
}

function metadata(messageId: string): GmailMessage {
  const rank = messageId.replace("msg-", "")
  return {
    id: messageId,
    threadId: messageId,
    labelIds: [],
    snippet: `Snippet ${rank}`,
    payload: {
      headers: [
        { name: "Subject", value: `Subject ${rank}` },
        { name: "From", value: `sender${rank}@example.com` },
        { name: "Date", value: `Date ${rank}` }
      ]
    }
  }
}

function createContext() {
  const listMessagesMock = vi.fn().mockResolvedValue({
    messages: [1, 2, 3, 4, 5].map((rank) => message(`msg-${rank}`)),
    resultSizeEstimate: 50
  })
  const getMessageMetadataMock = vi.fn((messageId: string) =>
    Promise.resolve(metadata(messageId))
  )

  const ctx = {
    gmail: {
      listMessages: listMessagesMock,
      getMessage: vi.fn(),
      getMessageMetadata: getMessageMetadataMock,
      listLabels: vi.fn().mockResolvedValue({ labels: [] }),
      updateLabels: vi.fn()
    },
    memory: {
      read: vi.fn(),
      write: vi.fn()
    },
    models: {}
  } as unknown as Context

  return { ctx, listMessagesMock, getMessageMetadataMock }
}

describe("discover_emails", () => {
  it("uses explicit query, offset, and limit without expanding the result set", async () => {
    const { ctx, listMessagesMock, getMessageMetadataMock } = createContext()
    const tool = discoverEmailsTool()

    const output = await tool.execute(
      { ctx, agent: {} as any },
      {
        intent: "first 4 unread emails",
        query: "is:unread",
        offset: 0,
        limit: 4
      }
    )

    expect(listMessagesMock).toHaveBeenCalledWith("is:unread", 0, 4)
    expect(getMessageMetadataMock).toHaveBeenCalledTimes(4)
    expect(output).toContain("Returned 4 messages from offset 0.")
    expect(output).toContain("1. Subject 1")
    expect(output).toContain("4. Subject 4")
    expect(output).not.toContain("Subject 5")
  })

  it("carries offset and limit constraints into natural-language search prompts", () => {
    const prompt = buildSearchPrompt({
      intent: "unread emails",
      offset: 0,
      limit: 4
    })

    expect(prompt).toContain("Offset: 0")
    expect(prompt).toContain("Limit: 4")
    expect(prompt).toContain("Preserve the list_messages result order")
  })
})
