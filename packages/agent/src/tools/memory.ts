import { tool } from "aio"
import { z } from "zod"

import { Context } from "../types"

export function readMemoryTool() {
  return tool<Context>({
    description:
      "Read the user's persistent memory: habits, preferences, naming conventions, and past organization patterns. Call this before making decisions to stay consistent with the user's style.",
    parameters: z.object({}),
    execute: ({ ctx }) => ctx.memory.read()
  })
}

export function appendMemoryTool() {
  return tool<Context>({
    description:
      "Record new learnings about the user — preferences, recurring patterns, naming conventions, etc. Write in concise markdown. Only record insights that will help future decisions.",
    parameters: z.object({
      content: z
        .string()
        .describe(
          "New markdown content to record. Previous content is preserved automatically."
        )
    }),
    execute: async ({ ctx }, args) => {
      await ctx.memory.write(args.content)
      return "Memory updated successfully."
    }
  })
}
