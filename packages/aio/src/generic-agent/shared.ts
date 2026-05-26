import type { ModelMessage } from "ai"

import type { Agent, MessageContentPart } from "../types"
import type { TracePayload } from "./trace-events"

export function trace(agent: Agent, event: TracePayload) {
  const traces = Array.isArray(agent.trace)
    ? agent.trace
    : agent.trace
      ? [agent.trace]
      : []
  traces.forEach((trace) => {
    trace.write({
      timestamp: new Date(),
      agentName: agent.name,
      ...event
    })
  })
}

export async function buildModelConfig(messages: ModelMessage[], agent: Agent) {
  return Object.assign(agent.getModelConfig(), {
    system: await agent.getSystemInstruction(),
    messages,
    tools: agent.tools.getTools() as unknown
  })
}

export function extractParts<T extends MessageContentPart["type"]>(
  content: ModelMessage["content"],
  type: T
): Extract<MessageContentPart, { type: T }>[] {
  if (typeof content === "string") {
    if (type === "text") {
      return [{ type: "text", text: content } as any]
    }
    return []
  }
  if (!Array.isArray(content)) return []
  return content.filter((part): part is any => part.type === type)
}
