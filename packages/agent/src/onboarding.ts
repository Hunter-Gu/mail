import { AgentTools, runGenericAgent } from "aio"
import type { IAgent } from "aio"

import { SYSTEM_INSTRUCTION } from "./prompts/onboarding"
import { getMessageTool, listLabelsTool, listMessagesTool } from "./tools/gmail"
import { appendMemoryTool, readMemoryTool } from "./tools/memory"
import type { Context } from "./types"

class OnboardingAgent implements IAgent<Context> {
  name = "OnboardingAgent"

  get trace() {
    return this.ctx.trace
  }

  tools = new AgentTools<Context>()
  maxIterations = 10

  onToolCall?: (name: string, args: Record<string, unknown>) => void
  onText?: (text: string) => void
  onError?: (error: unknown) => void

  constructor(private ctx: Context) {
    this.tools
      .register("list_labels", listLabelsTool())
      .register("list_messages", listMessagesTool())
      .register("get_message", getMessageTool())
      .register("append_memory", appendMemoryTool())
      .register("read_memory", readMemoryTool())
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
}

export async function runOnboardingAgent(ctx: Context) {
  console.log("🎓  Onboarding Agent starting — learning your Gmail...\n")

  const agent = new OnboardingAgent(ctx)

  const runner = runGenericAgent(agent, ctx)

  const result = await runner.prompt(
    "Please begin onboarding. Explore my Gmail and write the memory file."
  )
  return result.text
}
