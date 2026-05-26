import { tool as aiTool } from "ai"
import z from "zod"

import { Context, type Agent } from "./types"

export function tool<
  TContext extends Context = Context,
  Parameters = z.ZodType<any>
>(tool: AgentTool<TContext, Parameters>) {
  return tool
}

export interface AgentTool<
  TContext extends Context = Context,
  Parameters = z.ZodType<any>
> {
  description: string
  parameters: Parameters
  execute(
    env: { ctx: TContext; agent: Agent<TContext> },
    args: z.infer<Parameters>
  ): any
}

export type ToolResult = string

export class AgentTools<TContext extends Context = Context> {
  private tools = new Map<string, AgentTool<TContext>>()

  register(name: string, tool: AgentTool<TContext>) {
    this.tools.set(name, tool)
    return this
  }

  unregister(name: string) {
    this.tools.delete(name)
    return this
  }

  getTools() {
    return Array.from(this.tools.entries()).reduce(
      (acc, [name, tool]) => ({
        ...acc,
        [name]: aiTool({
          description: tool.description,
          inputSchema: tool.parameters
          // No execute — we handle tool calls manually in the agent loop
        })
      }),
      {}
    )
  }

  async executeTool(
    env: { ctx: TContext; agent: Agent<TContext> },
    name: string,
    args: Record<string, any>
  ): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return `Unknown tool: ${name}`
    }
    return tool.execute(env, args)
  }
}

export function createTool(name: string, tool: AgentTool) {
  return { name, tool }
}
