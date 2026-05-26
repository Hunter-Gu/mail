import { beforeEach, describe, expect, it, vi } from "vitest"

import { MaxIterationsError, runGenericAgent } from "../generic-agent"
import { AgentTools } from "../tools"
import { Trace } from "../trace"
import type { IAgent, IAgentStream } from "../types"

const generateText = vi.hoisted(() => vi.fn())
const streamText = vi.hoisted(() => vi.fn())
const aiTool = vi.hoisted(() => vi.fn((config) => config))

vi.mock("ai", () => ({
  generateText,
  streamText,
  tool: aiTool
}))

function parseTraceRecords(writes: string[]) {
  return writes
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const { timestamp, ...record } = JSON.parse(line)
      expect(timestamp).toEqual(expect.any(String))
      return record
    })
}

describe("runGenericAgent", () => {
  beforeEach(() => {
    generateText.mockReset()
    streamText.mockReset()
    aiTool.mockClear()
  })

  it("emits text and token usage through agent callbacks", async () => {
    generateText.mockResolvedValueOnce({
      finishReason: "stop",
      response: {
        messages: [{ role: "assistant", content: "done" }]
      },
      text: "done",
      reasoningText: undefined,
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
    })

    const onText = vi.fn()
    const onTokenUsage = vi.fn()
    const agent: IAgent = {
      name: "memo.test",
      tools: new AgentTools(),
      getSystemInstruction: () => "system",
      getModelConfig: () => ({ model: "mock-model" }) as never,
      onText,
      onTokenUsage
    }

    const runner = await runGenericAgent(agent, {})
    const output = await runner.prompt("hello")

    expect(output.text).toBe("done")
    expect(onText).toHaveBeenCalledWith("done")
    expect(onTokenUsage).toHaveBeenCalledWith({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3
    })
  })

  it("writes prompt, model, and usage events to trace", async () => {
    generateText.mockResolvedValueOnce({
      finishReason: "stop",
      response: {
        messages: [{ role: "assistant", content: "done" }]
      },
      text: "done",
      reasoningText: "thinking",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
    })

    const writes: string[] = []
    const agent: IAgent = {
      name: "memo.test",
      trace: new Trace({
        batch: true,
        write: (content) => {
          writes.push(content)
        }
      }),
      tools: new AgentTools(),
      getSystemInstruction: () => "system",
      getModelConfig: () => ({ model: "mock-model" }) as never
    }

    const runner = await runGenericAgent(agent, {})
    await runner.prompt("hello")

    expect(parseTraceRecords(writes)).toEqual([
      {
        agentName: "memo.test",
        type: "message",
        content: "hello"
      },
      {
        agentName: "memo.test",
        type: "reasoning",
        content: "thinking"
      },
      {
        agentName: "memo.test",
        type: "text",
        content: "done"
      },
      {
        agentName: "memo.test",
        type: "token-usage",
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
      }
    ])
  })

  it("emits tool calls and tool results through agent callbacks", async () => {
    generateText
      .mockResolvedValueOnce({
        finishReason: "tool-calls",
        response: {
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "tool-call",
                  toolCallId: "call-1",
                  toolName: "lookup",
                  input: { query: "hello" }
                }
              ]
            }
          ]
        },
        text: "",
        reasoningText: undefined,
        toolCalls: [
          {
            toolCallId: "call-1",
            toolName: "lookup",
            input: { query: "hello" }
          }
        ],
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        response: {
          messages: [{ role: "assistant", content: "complete" }]
        },
        text: "complete",
        reasoningText: undefined,
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
      })

    const onToolCall = vi.fn()
    const onToolResult = vi.fn()
    const tools = new AgentTools().register("lookup", {
      description: "Lookup",
      parameters: {} as never,
      execute: async (_env, args) => `found:${args.query}`
    })
    const agent: IAgent = {
      tools,
      getSystemInstruction: () => "system",
      getModelConfig: () => ({ model: "mock-model" }) as never,
      onToolCall,
      onToolResult
    }

    const runner = await runGenericAgent(agent, {})
    const output = await runner.prompt("hello")

    expect(output.text).toBe("complete")
    expect(onToolCall).toHaveBeenCalledWith("lookup", { query: "hello" })
    expect(onToolResult).toHaveBeenCalledWith("lookup", "found:hello")
  })

  it("writes tool calls and tool results to trace", async () => {
    generateText
      .mockResolvedValueOnce({
        finishReason: "tool-calls",
        response: {
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "tool-call",
                  toolCallId: "call-1",
                  toolName: "lookup",
                  input: { query: "hello" }
                }
              ]
            }
          ]
        },
        text: "",
        reasoningText: undefined,
        toolCalls: [
          {
            toolCallId: "call-1",
            toolName: "lookup",
            input: { query: "hello" }
          }
        ],
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        response: {
          messages: [{ role: "assistant", content: "complete" }]
        },
        text: "complete",
        reasoningText: undefined,
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
      })

    const writes: string[] = []
    const tools = new AgentTools().register("lookup", {
      description: "Lookup",
      parameters: {} as never,
      execute: async (_env, args) => `found:${args.query}`
    })
    const agent: IAgent = {
      name: "memo.test",
      trace: new Trace({
        batch: true,
        write: (content) => {
          writes.push(content)
        }
      }),
      tools,
      getSystemInstruction: () => "system",
      getModelConfig: () => ({ model: "mock-model" }) as never
    }

    const runner = await runGenericAgent(agent, {})
    await runner.prompt("hello")

    expect(parseTraceRecords(writes)).toEqual([
      {
        agentName: "memo.test",
        type: "message",
        content: "hello"
      },
      {
        agentName: "memo.test",
        type: "tool-call",
        toolName: "lookup",
        input: { query: "hello" }
      },
      {
        agentName: "memo.test",
        type: "token-usage",
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
      },
      {
        agentName: "memo.test",
        type: "tool-result",
        toolName: "lookup",
        output: "found:hello"
      },
      {
        agentName: "memo.test",
        type: "text",
        content: "complete"
      },
      {
        agentName: "memo.test",
        type: "token-usage",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
      }
    ])
  })

  it("writes completed streaming output to trace", async () => {
    async function* fullStream() {
      yield { type: "reasoning-delta", text: "think" }
      yield { type: "reasoning-delta", text: "ing" }
      yield { type: "text-delta", text: "do" }
      yield { type: "text-delta", text: "ne" }
    }

    streamText.mockReturnValueOnce({
      fullStream: fullStream(),
      usage: Promise.resolve({
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3
      }),
      finishReason: Promise.resolve("stop"),
      response: Promise.resolve({
        messages: [{ role: "assistant", content: "done" }]
      }),
      toolCalls: Promise.resolve([])
    })

    const writes: string[] = []
    const agent: IAgentStream = {
      name: "memo.stream",
      streaming: true,
      trace: new Trace({
        batch: true,
        write: (content) => {
          writes.push(content)
        }
      }),
      tools: new AgentTools(),
      getSystemInstruction: () => "system",
      getModelConfig: () => ({ model: "mock-model" }) as never
    }

    const runner = await runGenericAgent(agent, {})
    const output = await runner.prompt("hello")

    expect(output.text).toBe("done")
    expect(parseTraceRecords(writes)).toEqual([
      {
        agentName: "memo.stream",
        type: "message",
        content: "hello"
      },
      {
        agentName: "memo.stream",
        type: "reasoning",
        content: "thinking"
      },
      {
        agentName: "memo.stream",
        type: "text",
        content: "done"
      },
      {
        agentName: "memo.stream",
        type: "token-usage",
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
      }
    ])
  })

  it("throws when the max iteration guard stops before a final response", async () => {
    generateText.mockResolvedValueOnce({
      finishReason: "tool-calls",
      response: {
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "lookup",
                input: { query: "hello" }
              }
            ]
          }
        ]
      },
      text: "",
      reasoningText: undefined,
      toolCalls: [
        {
          toolCallId: "call-1",
          toolName: "lookup",
          input: { query: "hello" }
        }
      ],
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
    })

    const askContinue = vi.fn(() => false)
    const tools = new AgentTools().register("lookup", {
      description: "Lookup",
      parameters: {} as never,
      execute: async (_env, args) => `found:${args.query}`
    })
    const agent: IAgent = {
      tools,
      maxIterations: 1,
      askContinue,
      getSystemInstruction: () => "system",
      getModelConfig: () => ({ model: "mock-model" }) as never
    }

    const runner = await runGenericAgent(agent, {})

    await expect(runner.prompt("hello")).rejects.toThrow(MaxIterationsError)
    expect(askContinue).toHaveBeenCalledOnce()
  })

  it("provides extraParts function to extract specific blocks", async () => {
    generateText.mockResolvedValueOnce({
      finishReason: "stop",
      response: {
        messages: [
          {
            role: "assistant",
            content: [
              { type: "text", text: "result text" },
              { type: "image", image: "data:image/png;base64,..." }
            ]
          }
        ]
      },
      text: "result text",
      reasoningText: undefined,
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
    })

    const agent: IAgent = {
      name: "extra.parts.test",
      tools: new AgentTools(),
      getSystemInstruction: () => "system",
      getModelConfig: () => ({ model: "mock-model" }) as never
    }

    const runner = await runGenericAgent(agent, {})
    const output = await runner.prompt("hello")

    expect(output.text).toBe("result text")
    expect(output.extraParts("text")).toEqual([{ type: "text", text: "result text" }])
    expect(output.extraParts("image")).toEqual([{ type: "image", image: "data:image/png;base64,..." }])
  })
})

