# log-server

A lightweight TypeScript HTTP server that receives AI interaction logs locally and stores them securely.

## What it is
`log-server` is a dedicated, self-contained service designed to ingest and serialize logs from client applications. It supports:
- **Namespace-based routing**: Saves logs to isolated project subfolders to serve multiple applications.
- **Session-scoped files**: Uses session IDs directly in log filenames.
- **Multiple formats**: Writes in either raw line-by-line JSON Lines (`.jsonl`) or beautifully formatted JSON arrays (`.json`).
- **Concurrent safety**: Uses pure-promise per-file mutex locks to ensure concurrent JSON appends do not corrupt files.
- **Security controls**: Automatically blocks directory traversal attacks on `namespace` and `sessionId` parameters.

---

## Examples

### Running the Server
To run the server in development mode:
```bash
pnpm --filter log-server dev
```

To run unit tests:
```bash
pnpm --filter log-server test
```

### Client Ingestion Example
`log-server` exports browser-safe, fetch-based logger utilities directly from its primary entry point. It has zero Node.js dependencies.

```typescript
import { logToServer } from "log-server"

await logToServer(
  { role: "user", content: "Hello!" },
  {
    namespace: "chat-bot-v2",
    sessionId: "sess-90812",
    type: "json"
  }
)
```


---

## Server API (`log-server/server`)

Import from `log-server/server` to control or interact with the server programmatically inside Node.js environments:

### `createLogServer(baseLogDir?: string): http.Server`
Creates and returns the Node.js standard HTTP server configured to handle CORS preflight and parse, validate, and write log payloads securely.
- **Arguments**:
  - `baseLogDir` *(optional)*: Path to the directory where logs will be stored. Defaults to `LOG_DIR`.

### `DEFAULT_PORT: number`
The default port number `3456` on which the server listens.

### `LOG_DIR: string`
The default path where logs are stored: `tmp/ai-logs` (resolved relative to `process.cwd()`).

### `LogRequestPayload`
TypeScript interface representing the expected shape of the log ingestion payload:
```typescript
interface LogRequestPayload {
  namespace?: string;   // Optional subdirectory name
  sessionId: string;    // Unique string used as the file name
  data?: any;           // The exact payload to log (falls back to full payload if omitted)
  type?: "json" | "jsonl"; // Serialization format. Defaults to 'jsonl'
}
```

---

## Client API (`log-server`)

The primary entry point is browser-safe and exposes:

### `logToServer(data: any, options: LogOptions): Promise<{ ok: boolean; error?: string }>`
Performs an async POST request to transmit the payload to the log-server.
- **Arguments**:
  - `data`: The log payload to record.
  - `options`: Config objects containing the session identifier and serialization formatting.


### `LogOptions`
TypeScript configuration options for the client helper:
```typescript
interface LogOptions {
  serverUrl?: string;   // Defaults to "http://localhost:3456/api/ai-log"
  namespace?: string;   // Target subdirectory folder
  sessionId: string;    // Output filename
  type?: "json" | "jsonl"; // Serialization format (defaults to "jsonl")
}
```

