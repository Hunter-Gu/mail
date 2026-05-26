import type { ModelMessage } from "ai"

import type { Trace } from "../trace"
import type { Agent, Context } from "../types"
import { runToolLoop } from "./agent-loop"
import { trace } from "./shared"
import type { TraceEvent } from "./trace-events"
import { TraceEventType } from "./trace-events"

export function runGenericAgent<TContext extends Context = Context>(
  agent: Agent<TContext>,
  ctx: TContext
) {
  const messages: ModelMessage[] = []

  const prompt = async (userInput: string) => {
    if (messages.length === 0 && agent.getInitialMessages) {
      const initial = await agent.getInitialMessages()
      messages.push(...initial)
    }

    messages.push({ role: "user", content: userInput })
    trace(agent, {
      type: TraceEventType.InputMessage,
      content: userInput
    })

    try {
      return await runToolLoop(messages, agent, ctx)
    } finally {
      await flushTraces(agent)
    }
  }

  return {
    prompt,
    set(history: ModelMessage[]) {
      messages.length = 0
      messages.push(...history)
    },
    clear() {
      messages.length = 0
    },
    getMessages() {
      return [...messages]
    }
  }
}

function flushTraces(agent: Agent) {
  return Promise.all(
    ([] as Trace<TraceEvent>[])
      .concat(agent.trace ?? [])
      .map((t) => t.flush?.())
  )
}
