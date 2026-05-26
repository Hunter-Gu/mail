# AIO

## What it is

A model-agnostic agent loop built on the ai SDK. It manages tool registration,
model turns, tool execution, optional NDJSON tracing, streaming and
non-streaming callbacks, and a max-iteration guard.

## Examples

```ts
import {
  AgentTools,
  Trace,
  runGenericAgent,
  tool,
  type TraceEvent,
  type IAgent
} from "aio"
import { appendFile } from "node:fs/promises"
import z from "zod"

const tools = new AgentTools().register(
  "echo",
  tool({
    description: "Echo back text.",
    parameters: z.object({ text: z.string() }),
    async execute(_env, { text }) {
      return `echo: ${text}`
    }
  })
)

class DemoAgent implements IAgent {
  name = "demo"
  trace?: Trace<TraceEvent> | Trace<TraceEvent>[]
  tools: AgentTools
  maxIterations = 10

  constructor(tools: AgentTools) {
    this.tools = tools
  }

  async getSystemInstruction() {
    return "You are a helpful assistant. Use tools when appropriate."
  }

  getModelConfig() {
    return {
      model: myModel,
      temperature: 0.2
    }
  }

  onText(text: string) {
    console.log(text)
  }
}

const agent = new DemoAgent(tools)
agent.trace = new Trace({
  batch: true,
  write: (content) => appendFile(".trace/demo.ndjson", content)
})

const ctx = {}
const runner = await runGenericAgent(agent, ctx)
const output = await runner.prompt("Say hello and use the echo tool.")
```

## API
- `runGenericAgent(agent, ctx)`: Runs the agent loop and returns a runner with
  `prompt`, `set`, `clear`, and `getMessages` helpers. `prompt(input)`
  resolves to the final assistant output after any tool-call rounds complete.
  When `agent.trace` is present (single trace or array), prompts, model
  text/reasoning, completed streamed text/reasoning, tool calls/results, tool
  errors, and token usage are written to each trace and flushed after each
  prompt.
- `MaxIterationsError`: Error thrown when the max-iteration guard stops the
  tool loop before a final assistant output is produced.
- `AgentTools`: Tool registry used by agents; supports `register`,
  `unregister`, `getTools`, and `executeTool`.
- `tool(toolDef)`: Helper to define a tool with a Zod input schema.
- `createTool(name, toolDef)`: Wraps a named tool for bulk registration.
- `Trace`: NDJSON trace writer for agent events and custom records. Use
  `new Trace({ write })` for immediate writes or `new Trace({ batch: true,
  write })` to buffer events until `flush`.
- `jsonLine(record)`: Serializes a trace record to one JSON line.
- Types:
  - `AgentTool`: Tool definition shape.
  - `ToolResult`: Tool execution return type.
  - `Context`: Base context object.
  - `IAgentBase`, `IAgent`, `IAgentStream`, `Agent`: Agent interfaces and
    union. `IAgentBase` defines `onText`/`onReasoning` plus
    `onTextDelta`/`onReasoningDelta`. Deltas stream during streaming runs and
    fire once with `done=true` for non-streaming runs.
  - `TraceEvent`, `TraceEventType`: Trace event union and event type enum
    emitted by the generic agent loop.
  - `TraceWriter`: Writer accepted by `Trace`.
