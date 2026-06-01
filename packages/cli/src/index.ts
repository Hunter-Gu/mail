import "dotenv/config"

import { stdin as input, stdout as output } from "node:process"
import * as readline from "node:readline/promises"
import { runOrchestratorAgent, type Context } from "agent"

import { ensureGmailAuth } from "./auth"
import { createGwsGmailClient } from "./gws"
import { appendMemory, readMemory } from "./memory"
import { createModels } from "./models"
import { createTrace } from "./trace"

async function main() {
  await ensureGmailAuth()

  const rl = readline.createInterface({ input, output })

  const ctx: Context = {
    trace: [await createTrace()],
    models: createModels(),
    gmail: createGwsGmailClient(),
    memory: {
      read: readMemory,
      write: appendMemory
    },
    async askContinue() {
      const answer = await rl.question(
        "Agent has made 10 tool calls. Continue? [y/N] "
      )
      return answer.trim().toLowerCase() === "y"
    },
    onReasoningDelta(delta, done) {
      if (!done) {
        // Dim/grey so it's visually distinct from the actual response
        process.stdout.write(`\x1b[2m${delta}\x1b[0m`)
      } else {
        process.stdout.write("\n")
      }
    },
    onTextDelta(delta, done) {
      if (!done) {
        process.stdout.write(delta)
      } else {
        // Final flush: print trailing newline to close the response block
        process.stdout.write("\n\n")
      }
    },
    onToolCall(name) {
      process.stdout.write(`\n[tool: ${name}] `)
    },
    onToolResult(_name, result) {
      const preview =
        result.length > 300 ? result.slice(0, 300) + " ..." : result
      process.stdout.write(`\x1b[2m${preview}\x1b[0m\n`)
    }
  }

  const runner = runOrchestratorAgent(ctx)

  console.log("Gmail agent ready. Type `exit` to quit.\n")

  try {
    while (true) {
      const userInput = (await rl.question("You: ")).trim()
      if (!userInput) continue
      if (userInput.toLowerCase() === "exit") break

      process.stdout.write("\nAgent: ")

      try {
        await runner.prompt(userInput)
      } catch (error) {
        if (error instanceof Error && error.name === "MaxIterationsError") {
          console.error("Stopped after reaching the tool-call limit.")
        } else {
          console.error("Error:", error)
        }
      }
    }
  } finally {
    rl.close()
  }
}

main().catch((error) => {
  console.error("An error occurred:", error)
  process.exit(1)
})
