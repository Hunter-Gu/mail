import { generateText } from "ai"
import type { ModelMessage } from "ai"

import type { IAgent } from "../types"
import { buildModelConfig, trace } from "./shared"
import { TraceEventType } from "./trace-events"

export async function generateMessage(messages: ModelMessage[], agent: IAgent) {
  const result = await generateText(
    (await buildModelConfig(messages, agent)) as Parameters<
      typeof generateText
    >[0]
  )

  if (result.reasoningText) {
    agent.onReasoningDelta?.(result.reasoningText, true)
    agent.onReasoning?.(result.reasoningText)
    trace(agent, {
      type: TraceEventType.Reasoning,
      content: result.reasoningText
    })
  }
  if (result.text) {
    agent.onTextDelta?.(result.text, true)
    agent.onText?.(result.text)
    trace(agent, {
      type: TraceEventType.Text,
      content: result.text
    })
  }
  for (const call of result.toolCalls) {
    agent.onToolCall?.(call.toolName, call.input as Record<string, unknown>)
    trace(agent, {
      type: TraceEventType.ToolCall,
      toolName: call.toolName,
      input: call.input
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
    finishReason: result.finishReason,
    responseMessages: result.response.messages,
    toolCalls: result.toolCalls
  }
}
