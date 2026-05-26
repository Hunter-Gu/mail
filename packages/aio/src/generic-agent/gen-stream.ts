import { streamText } from "ai"
import type { ModelMessage } from "ai"

import type { IAgentStream } from "../types"
import { buildModelConfig, trace } from "./shared"
import { TraceEventType } from "./trace-events"

export async function streamMessage(
  messages: ModelMessage[],
  agent: IAgentStream
) {
  const result = streamText(
    (await buildModelConfig(messages, agent)) as Parameters<
      typeof streamText
    >[0]
  )
  let text = ""
  let reasoning = ""

  for await (const chunk of result.fullStream) {
    if (chunk.type === "text-delta") {
      text += chunk.text
      agent.onTextDelta?.(chunk.text, false)
    } else if (chunk.type === "reasoning-delta") {
      reasoning += chunk.text
      agent.onReasoningDelta?.(chunk.text, false)
    } else if (chunk.type === "tool-call") {
      agent.onToolCall?.(chunk.toolName, chunk.input as Record<string, unknown>)
      trace(agent, {
        type: TraceEventType.ToolCall,
        toolName: chunk.toolName,
        input: chunk.input
      })
    }
  }

  if (reasoning) {
    agent.onReasoningDelta?.("", true)
    agent.onReasoning?.(reasoning)
    trace(agent, {
      type: TraceEventType.Reasoning,
      content: reasoning
    })
  }
  if (text) {
    agent.onTextDelta?.("", true)
    agent.onText?.(text)
    trace(agent, {
      type: TraceEventType.Text,
      content: text
    })
  }

  if (agent.onTokenUsage || agent.trace) {
    const usage = await result.usage
    agent.onTokenUsage?.(usage)
    trace(agent, {
      type: TraceEventType.TokenUsage,
      usage
    })
  }

  return {
    finishReason: await result.finishReason,
    responseMessages: (await result.response).messages,
    toolCalls: await result.toolCalls
  }
}
