import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer, type IncomingMessage, type Server } from "node:http"
import { join, resolve } from "node:path"

export interface LogRequestPayload {
  namespace?: string
  sessionId: string
  data?: Record<string, unknown>
  type?: "json" | "jsonl"
}

export const DEFAULT_PORT = 3456
export const LOG_DIR = resolve(process.cwd(), "tmp", "ai-logs")

// In-memory locks to prevent concurrent write race conditions on the same file
const fileLocks = new Map<string, Promise<void>>()

/**
 * Executes an operation on a file inside an exclusive lock context.
 */
async function lockFile(
  filepath: string,
  fn: () => Promise<void>
): Promise<void> {
  const currentLock = fileLocks.get(filepath) || Promise.resolve()
  const nextLock = currentLock.then(fn).catch((err) => {
    console.error(`[log-server] Error during locked write to ${filepath}:`, err)
    throw err
  })
  fileLocks.set(filepath, nextLock)

  nextLock.finally(() => {
    if (fileLocks.get(filepath) === nextLock) {
      fileLocks.delete(filepath)
    }
  })

  return nextLock
}

/**
 * Creates the HTTP Log Server instance.
 */
export function createLogServer(baseLogDir = LOG_DIR): Server {
  return createServer(async (req, res) => {
    // CORS configuration for local development
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")

    if (req.method === "OPTIONS") {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method !== "POST" || req.url !== "/api/ai-log") {
      res.writeHead(404)
      res.end("Not found")
      return
    }

    try {
      const body = await readBody(req)
      const payload: LogRequestPayload = JSON.parse(body)

      const { namespace, sessionId, data, type = "jsonl" } = payload

      // 1. Validate sessionId is present and safe
      if (!sessionId || typeof sessionId !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({ ok: false, error: "Missing or invalid sessionId" })
        )
        return
      }

      if (
        /[^a-zA-Z0-9_\-]/.test(sessionId) ||
        sessionId.includes("..") ||
        sessionId.includes("\0")
      ) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            ok: false,
            error: "Invalid characters in sessionId"
          })
        )
        return
      }

      // 2. Validate namespace format if provided
      if (namespace !== undefined) {
        if (
          typeof namespace !== "string" ||
          /[^a-zA-Z0-9_\-\/]/.test(namespace) ||
          namespace.includes("..") ||
          namespace.includes("\0")
        ) {
          res.writeHead(400, { "Content-Type": "application/json" })
          res.end(
            JSON.stringify({
              ok: false,
              error: "Invalid characters in namespace"
            })
          )
          return
        }
      }

      // 3. Validate type
      if (type !== "json" && type !== "jsonl") {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({ ok: false, error: "Type must be 'json' or 'jsonl'" })
        )
        return
      }

      // Determine target folder & verify path starts with base directory
      const targetDir = namespace ? resolve(baseLogDir, namespace) : baseLogDir
      if (!targetDir.startsWith(baseLogDir)) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            ok: false,
            error: "Path traversal detected in namespace"
          })
        )
        return
      }

      await mkdir(targetDir, { recursive: true })

      const filename = `${sessionId}.${type}`
      const filepath = join(targetDir, filename)

      // Support legacy structure: fallback to full payload if data is not explicitly provided
      const logData = data !== undefined ? data : payload

      // Safe concurrent writing with per-file mutex lock
      await lockFile(filepath, async () => {
        if (type === "json") {
          let list: unknown[] = []
          try {
            const content = await readFile(filepath, "utf-8")
            const parsed = JSON.parse(content)
            list = Array.isArray(parsed) ? parsed : [parsed]
          } catch {
            // File does not exist or is invalid JSON
            list = []
          }
          list.push(logData)
          await writeFile(filepath, JSON.stringify(list, null, 2), "utf-8")
        } else {
          // jsonl format
          await appendFile(filepath, JSON.stringify(logData) + "\n", "utf-8")
        }
      })

      console.log(
        `[log-server] Written log to ${filename} under namespace '${namespace || "default"}'`
      )

      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true }))
    } catch (err) {
      console.error("[log-server] Error parsing or writing log:", err)
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: false, error: String(err) }))
    }
  })
}

/**
 * Reads full request body as a string.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", (chunk) => (data += chunk))
    req.on("end", () => resolve(data))
    req.on("error", reject)
  })
}

// Start the server if executing this file directly
if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  const PORT = parseInt(process.env.PORT || String(DEFAULT_PORT), 10)
  const server = createLogServer()
  server.listen(PORT, () => {
    console.log(`[log-server] Listening on http://localhost:${PORT}`)
    console.log(`[log-server] Logs saved to ${LOG_DIR}`)
  })
}
