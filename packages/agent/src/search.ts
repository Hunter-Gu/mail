import { AgentTools, runGenericAgent, tool } from "aio"
import type { IAgent } from "aio"
import { z } from "zod"

import { SYSTEM_INSTRUCTION } from "./prompts/search"
import {
  listLabelsTool,
  listMessages,
  listMessagesTool,
  MAX_LIST_MESSAGES_LIMIT
} from "./tools/gmail"
import type { Context } from "./types"

const DEFAULT_DISCOVER_EMAILS_LIMIT = 30

export type SearchRequest = {
  intent: string
  query?: string
  offset?: number
  limit?: number
}

class SearchAgent implements IAgent<Context> {
  name = "SearchAgent"

  get trace() {
    return this.ctx.trace
  }

  tools = new AgentTools<Context>()
  maxIterations = 10

  constructor(private ctx: Context) {
    this.tools
      .register("list_labels", listLabelsTool())
      .register("list_messages", listMessagesTool())
  }

  getSystemInstruction() {
    return SYSTEM_INSTRUCTION
  }

  getModelConfig() {
    return {
      model: this.ctx.models.search,
      temperature: 0.2
    }
  }

  onToolCall(name: string, args: Record<string, unknown>) {
    this.ctx.onToolCall?.(name, args)
  }

  onToolResult(name: string, result: string) {
    this.ctx.onToolResult?.(name, result)
  }
}

export async function runSearchAgent(
  ctx: Context,
  request: string | SearchRequest
) {
  const agent = new SearchAgent(ctx)
  const normalized = typeof request === "string" ? { intent: request } : request

  const runner = runGenericAgent(agent, ctx)
  const result = await runner.prompt(buildSearchPrompt(normalized))
  return result.text
}

export function buildSearchPrompt(request: SearchRequest) {
  const lines = [`Find emails: ${request.intent}`]
  const constraints = [
    request.query !== undefined
      ? `Gmail query: ${request.query || "(none)"}`
      : "",
    request.offset !== undefined ? `Offset: ${request.offset}` : "",
    request.limit !== undefined ? `Limit: ${request.limit}` : ""
  ].filter(Boolean)

  if (constraints.length > 0) {
    lines.push(
      "",
      "<structured_constraints>",
      ...constraints,
      "Use these constraints exactly when calling list_messages. Preserve the list_messages result order in your final summary; do not regroup or reorder the selected messages.",
      "</structured_constraints>"
    )
  }

  return lines.join("\n")
}

export function discoverEmailsTool() {
  return tool<Context>({
    description:
      "Discover emails matching a natural language intent. Use this as the sole discovery entry point. When query, offset, or limit are known, pass them explicitly; query/offset/limit follow list_messages semantics and preserve list order.",
    parameters: z.object({
      intent: z
        .string()
        .describe("Natural language description of what emails to find."),
      query: z
        .string()
        .describe(
          "Optional Gmail search query, same as list_messages (e.g. 'is:unread label:inbox', 'from:github.com')."
        )
        .optional(),
      offset: z
        .number()
        .int()
        .min(0)
        .describe(
          "Optional zero-based result offset, same as list_messages. Use 0 for the first result."
        )
        .optional(),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_LIST_MESSAGES_LIMIT)
        .describe(
          `Optional max messages to summarize, same as list_messages (max ${MAX_LIST_MESSAGES_LIMIT}).`
        )
        .optional()
    }),
    execute: async (_env, args) => {
      if (args.query !== undefined) {
        return listMessages(
          _env.ctx,
          args.query,
          args.offset ?? 0,
          args.limit ?? DEFAULT_DISCOVER_EMAILS_LIMIT
        )
      }

      const summary = await runSearchAgent(_env.ctx, {
        intent: args.intent,
        offset: args.offset,
        limit: args.limit
      })
      return summary || "No matching emails found."
    }
  })
}
