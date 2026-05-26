# mail

## What it is

A small TypeScript monorepo for the Gmail agent stack. It includes a
model-agnostic agent loop, a Gmail orchestration agent, a local CLI runner, a
log receiver, and a WXT Gmail side panel extension. This README is an index.
Each package has its own README with examples and API details.

## Packages

- [aio](packages/aio/README.md): Model-agnostic agent loop and tool registry.
- [agent](packages/agent/README.md): Gmail orchestration agents and Gmail client contracts.
- [log-server](packages/log-server/README.md): Local HTTP log receiver and browser-safe logging client.
