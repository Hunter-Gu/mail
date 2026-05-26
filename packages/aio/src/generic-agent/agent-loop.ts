import type { ModelMessage } from "ai"

import { createLimitRounds } from "../limit-rounds"
import type { Agent, Context, MessageContentPart } from "../types"
import { MaxIterationsError } from "./errors"
import { streamMessage } from "./gen-stream"
import { generateMessage } from "./gen-text"
import { extractParts } from "./shared"
import { executeToolCalls } from "./tool-call"

const DEFAULT_MAX_ITERATIONS = 10

export async function runToolLoop(
  messages: ModelMessage[],
  agent: Agent,
  ctx: Context
) {
  const maxIterations = agent.maxIterations ?? DEFAULT_MAX_ITERATIONS
  const roundLimit = createLimitRounds(maxIterations)

  // Inner loop: run until the model stops calling tools
  while (true) {
    if (roundLimit.done()) {
      if ((await agent.askContinue?.()) !== true) {
        throw new MaxIterationsError(maxIterations)
      }
      roundLimit.reset()
    }

    const { finishReason, responseMessages, toolCalls } = await (agent.streaming
      ? streamMessage(messages, agent)
      : generateMessage(messages, agent))

    messages.push(...responseMessages)

    if (finishReason !== "tool-calls") {
      const lastMessage = messages.at(-1)
      const text = lastMessage
        ? extractParts(lastMessage.content, "text")
            .map((part) => part.text)
            .join("")
        : ""
      return {
        text,
        message: lastMessage ?? { role: "assistant", content: "" },
        extraParts(type: MessageContentPart["type"]) {
          return extractParts(lastMessage?.content ?? [], type)
        }
      }
    }

    roundLimit.next()
    messages.push(...(await executeToolCalls(toolCalls, agent, ctx)))
  }
}
