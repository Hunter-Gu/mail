export interface LogOptions {
  serverUrl?: string
  namespace?: string
  sessionId: string
  type?: "json" | "jsonl"
}

export function createSessionId() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

/**
 * Sends a log payload directly to the log-server.
 * This is browser-safe and does not import any Node.js core libraries.
 */
export async function logToServer(
  data: Record<string, unknown>,
  options: LogOptions
): Promise<{ ok: boolean; error?: string }> {
  const {
    serverUrl = "http://localhost:3456/api/ai-log",
    namespace,
    sessionId,
    type = "jsonl"
  } = options

  try {
    const res = await fetch(serverUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        namespace,
        sessionId,
        data,
        type
      })
    })

    if (!res.ok) {
      const text = await res.text()
      return { ok: false, error: `HTTP ${res.status}: ${text}` }
    }

    const result = await res.json()
    return result as { ok: boolean; error?: string }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}
