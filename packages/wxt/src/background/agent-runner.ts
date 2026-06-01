import type { Context } from "agent"

type GmailAgentRunner = {
  prompt: (input: string) => Promise<{ text: string }>
  clear: () => void
}

let runner: GmailAgentRunner | undefined
let runnerTabId: number | undefined

export async function promptGmailAgent(
  ctx: Context,
  tabId: number | undefined,
  input: string
): Promise<string> {
  if (!runner || runnerTabId !== tabId) {
    const { runOrchestratorAgent } = await import("agent")
    runner = runOrchestratorAgent(ctx) as unknown as GmailAgentRunner
    runnerTabId = tabId
  }

  const result = await runner.prompt(input)
  return result.text
}



export function clearGmailAgentRunner(): void {
  runner?.clear()
  runner = undefined
  runnerTabId = undefined
}

