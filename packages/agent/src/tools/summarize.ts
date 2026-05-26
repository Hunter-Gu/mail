import { generateText } from "ai"

import { SYSTEM_PROMPT } from "../prompts/summary"
import type { Context } from "../types"

export const BODY_SUMMARIZE_THRESHOLD = 10_000

export async function summarizeIfNeeded(
  ctx: Context,
  body: string
): Promise<string> {
  if (body.length <= BODY_SUMMARIZE_THRESHOLD) return body

  console.log(
    `  [summarize] body too long (${body.length} chars), summarizing...`
  )

  const { text } = await generateText({
    model: ctx.models.summary,
    system: SYSTEM_PROMPT,
    prompt: body
  })

  return `[summarized] ${text}`
}
