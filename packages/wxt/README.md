# wxt

## What it is
A WXT browser extension that provides a native browser side panel for the Mail
Agent while the active tab is Gmail. The side panel UI never talks directly to
Gmail or the agent; background owns state and routes every request. The Gmail
content script runs inside the Gmail page and performs page-level actions via
InboxSDK and gmail-js, so the Gmail tab must be open for the agent to operate.

## Examples

Run the dev extension:

```bash
pnpm install
pnpm --filter wxt dev
```

```bash
pnpm --filter wxt build
```

## Usage

1. Run one of the dev commands or build the extension.
2. Enable developer mode in your browser.
3. Load the unpacked extension from the build output directory printed by WXT.
4. Open Gmail (keep the tab open) and click the extension action to open the
	native side panel.

## Core Principles and Gmail Integration

For detailed architecture, engineering principles (including InboxSDK and
gmail-js priority decisions), and directory module information of the Gmail
integration layer, see
[packages/wxt/src/gmail/README.md](packages/wxt/src/gmail/README.md).

## API
- `entrypoints/sidepanel`: Native extension side panel React chat UI.
- `entrypoints/background.ts`: Stores side panel state, enables the side panel only for Gmail tabs, and handles every UI/Gmail request.
- `entrypoints/content.ts`: Runs only on Gmail and registers the Gmail bridge.
- `entrypoints/gmail-main.content.ts`: Runs in Gmail's MAIN world and answers gmail-js bridge requests.
- `src/protocol.ts`: Shared message and state types for side panel, background, and content-script communication.
- `src/gmail`: Gmail DOM integration and network interception logic. Data-bearing APIs, including `messages:list`, are expected to prefer MAIN-world gmail-js/Gmail network data, with InboxSDK limited to navigation and UI synchronization. See [packages/wxt/src/gmail/README.md](packages/wxt/src/gmail/README.md) for details.
