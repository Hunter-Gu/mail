import type { ModelMessage, ToolSet, TypedToolCall } from "ai"

import type { Agent, Context } from "../types"
import { trace } from "./shared"
import { TraceEventType } from "./trace-events"

/** Executes all tool calls from a completed turn, returns tool-result messages. */
export async function executeToolCalls(
  toolCalls: TypedToolCall<ToolSet>[],
  agent: Agent,
  ctx: Context
): Promise<ModelMessage[]> {
  const resultMessages: ModelMessage[] = []

  for (const call of toolCalls) {
    let output: string
    try {
      output = await agent.tools.executeTool(
        { ctx, agent },
        call.toolName,
        call.input as Record<string, string>
      )
      agent.onToolResult?.(call.toolName, output)
    } catch (error) {
      agent.onError?.(error)
      trace(agent, {
        type: TraceEventType.ToolError,
        toolName: call.toolName,
        error
      })
      output = `Error: ${error instanceof Error ? error.message : String(error)}`
    }
    trace(agent, {
      type: TraceEventType.ToolResult,
      toolName: call.toolName,
      output
    })

    resultMessages.push({
      role: "tool",
      content: [
        {
          toolName: call.toolName,
          toolCallId: call.toolCallId,
          type: "tool-result",
          output:
            typeof output === "string"
              ? { type: "text", value: output }
              : { type: "json", value: output ?? null }
        }
      ]
    })
  }

  return resultMessages
}
