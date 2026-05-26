import { describe, expect, it } from "vitest"
import z from "zod"

import { AgentTools, tool } from "../tools"
import type { Context } from "../types"

describe("AgentTools", () => {
  it("registers and executes tools", async () => {
    const tools = new AgentTools<Context>()
    const pingTool = tool({
      description: "Ping tool",
      parameters: z.object({ value: z.string() }),
      execute: async (_env, args) => `pong:${args.value}`
    })

    tools.register("ping", pingTool)

    const result = await tools.executeTool(
      { ctx: {} as Context, agent: {} as never },
      "ping",
      { value: "hello" }
    )

    expect(result).toBe("pong:hello")
    expect(Object.keys(tools.getTools())).toContain("ping")
  })

  it("returns a friendly message for unknown tools", async () => {
    const tools = new AgentTools<Context>()

    const result = await tools.executeTool(
      { ctx: {} as Context, agent: {} as never },
      "missing",
      {}
    )

    expect(result).toBe("Unknown tool: missing")
  })
})
