import { describe, expect, it, vi } from "vitest"

import { listMessages, modifyMessageTool } from "../tools/gmail"
import type { Context } from "../types"

function createContext() {
  const listMessagesMock = vi.fn().mockResolvedValue({ messages: [] })
  const ctx = {
    gmail: {
      listMessages: listMessagesMock,
      getMessage: vi.fn(),
      getMessageMetadata: vi.fn(),
      listLabels: vi.fn(),
      updateLabels: vi.fn()
    },
    memory: {
      read: vi.fn(),
      write: vi.fn()
    },
    models: {}
  } as unknown as Context

  return { ctx, listMessagesMock }
}

describe("Gmail tools", () => {
  it("allows messages:list to request up to 100 results with an offset", async () => {
    const { ctx, listMessagesMock } = createContext()

    await listMessages(ctx, "in:inbox", 50, 100)

    expect(listMessagesMock).toHaveBeenCalledWith("in:inbox", 50, 100)
  })

  it("does not cap offset but clamps messages:list limit to the supported range", async () => {
    const { ctx, listMessagesMock } = createContext()

    await listMessages(ctx, undefined, 900, 500)
    await listMessages(ctx, undefined, -1, 0)

    expect(listMessagesMock).toHaveBeenNthCalledWith(1, undefined, 900, 100)
    expect(listMessagesMock).toHaveBeenNthCalledWith(2, undefined, 0, 1)
  })

  it("does not report a modify callback when Gmail returns a non-retryable update error", async () => {
    const onModified = vi.fn()
    const tool = modifyMessageTool(onModified)
    const ctx = {
      gmail: {
        updateLabels: vi.fn().mockResolvedValue({
          error: "Unsupported Gmail label update.",
          nonRetryable: true,
          userNotified: true
        })
      }
    } as unknown as Context

    const result = await tool.execute(
      { ctx, agent: {} as any },
      {
        messageId: "msg-1",
        addLabelIds: ["Test"],
        removeLabelIds: [],
        reason: "test"
      }
    )

    expect(result).toMatchObject({
      error: "Unsupported Gmail label update.",
      nonRetryable: true,
      userNotified: true
    })
    expect(onModified).not.toHaveBeenCalled()
  })
})
