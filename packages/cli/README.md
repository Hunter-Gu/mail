# cli

## What it is

Local terminal runner for the Gmail agent. It uses the Google Workspace CLI
(`gws`) to access Gmail, stores memory in `data/memory.md`, and writes NDJSON
traces under `logs/`.

## Configuration

Copy the example env file and set at least one model key:

```bash
cp .env.example .env
```

Environment variables:

- `GCLOUD_CLIENT_ID`, `GCLOUD_CLIENT_SECRET`: Optional. Used when your `gws`
	setup requires custom OAuth credentials.

## Examples

Install deps and run the CLI from the repo root:

```bash
pnpm install
npm install -g @googleworkspace/cli
cd packages/cli
cp .env.example .env
# edit .env and set DEEPSEEK_API_KEY
pnpm --filter cli dev
```

First run will prompt for Gmail login if needed:

```text
Gmail is not authenticated. Run `gws auth login -s gmail` now? [Y/n]
```

Then type prompts at the `You:` prompt. Type `exit` to quit.

```text
You: Summarize the last 5 unread emails.
```

After every 10 tool calls, the CLI asks whether to continue.

## API

- No public exports. Run the interactive CLI with `pnpm --filter cli dev`.
