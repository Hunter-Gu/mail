# agent

## What it is

Gmail orchestration agents and types for the mail assistant. The package
provides the main `GmailAgent`, a delegated search agent, Gmail client
contracts, tool wiring for discovery and label changes, and memory-aware
orchestration.

## Examples

```ts
import { runOrchestratorAgent, type Context } from "agent"

const ctx: Context = {
  models: {
    main: mainModel,
    search: searchModel,
    summary: summaryModel
  },
  memory: {
    read: async () => "",
    write: async () => {}
  },
  gmail: gmailClient,
  onTextDelta: (delta) => process.stdout.write(delta)
}

const runner = runOrchestratorAgent(ctx)
await runner.prompt("Mark the first 4 unread emails as read")
```

## API

- `GmailAgent`: Streaming orchestrator that interprets user goals, delegates
  email discovery, inspects messages, modifies labels, and records memory.
- `runOrchestratorAgent(ctx)`: Creates a `GmailAgent` and runs it through the
  generic AIO agent loop.
- `Context`: Runtime dependencies for models, Gmail access, memory, tracing,
  and streaming callbacks.
- `ContextModels`: Main, search, and summary model slots used by the agents.
- `GmailClient`: Agent-facing Gmail adapter interface for listing messages,
  reading messages, listing labels, and updating labels.
- `GmailClientResult<T>` / `GmailClientError`: Success-or-error result shape
  returned by Gmail adapters.
- `GmailLabel`, `GmailListLabelsResponse`: Gmail label data structures.
- `GmailMessageRef`, `GmailListMessagesResponse`: Message-list result types.
- `GmailMessage`, `GmailMessagePart`, `GmailMessagePartBody`, `GmailHeader`:
  Gmail message and MIME payload structures.
- `LabelId`, `LabelName`, `LabelMap`: Label identifier/name helper types.
- `isGmailClientError(value)`: Type guard for Gmail adapter errors.
