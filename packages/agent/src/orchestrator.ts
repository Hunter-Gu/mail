import { AgentTools, IAgentStream, runGenericAgent } from "aio"
import type { ModelMessage } from "ai"

import { SYSTEM_INSTRUCTION } from "./prompts/main"
import { discoverEmailsTool } from "./search"
import {
  getMessageMetadataTool,
  getMessageTool,
  listLabelsTool,
  modifyMessageTool
} from "./tools/gmail"
import { appendMemoryTool } from "./tools/memory"
import { Context } from "./types"

export class GmailAgent implements IAgentStream<Context> {
  name = "GmailAgent"

  get trace() {
    return this.ctx.trace
  }

  streaming = true as const
  tools = new AgentTools<Context>()
  maxIterations = 10

  askContinue() {
    return this.ctx.askContinue?.() ?? false
  }

  constructor(private ctx: Context) {
    this._initTools()
  }

  private _initTools() {
    this.tools
      .register("list_labels", listLabelsTool())
      .register("discover_emails", discoverEmailsTool())
      .register("get_message_metadata", getMessageMetadataTool())
      .register("get_message", getMessageTool())
      .register("modify_message", modifyMessageTool())
      .register("update_memory", appendMemoryTool())
  }

  async getInitialMessages(): Promise<ModelMessage[]> {
    const memory = await this.ctx.memory.read()
    if (!memory) return []
    return [
      {
        role: "user",
        content: `<user_memory>\n${memory}\n</user_memory>`
      },
      {
        role: "assistant",
        content:
          "Understood. I have your preferences and habits loaded — I'll use them to guide my decisions."
      }
    ]
  }

  getSystemInstruction() {
    return SYSTEM_INSTRUCTION
  }

  getModelConfig() {
    return {
      model: this.ctx.models.main,
      temperature: 0.2
    }
  }

  onTextDelta(delta: string, done: boolean) {
    this.ctx.onTextDelta?.(delta, done)
  }

  onReasoningDelta(delta: string, done: boolean) {
    this.ctx.onReasoningDelta?.(delta, done)
  }

  onToolCall(name: string, args: Record<string, unknown>) {
    this.ctx.onToolCall?.(name, args)
  }

  onToolResult(name: string, result: string) {
    this.ctx.onToolResult?.(name, result)
  }
}

export function runOrchestratorAgent(ctx: Context) {
  const agent = new GmailAgent(ctx)

  return runGenericAgent(agent, ctx)
}
