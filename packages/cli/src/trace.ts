import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { Trace, TraceEvent } from "aio"

const LOGS_DIR = join(import.meta.dirname, "../logs")

function tracePath(id: string): string {
  return join(LOGS_DIR, `${id}.ndjson`)
}

/** Generate a new trace ID from the current timestamp. */
function newTraceId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

export async function createTrace() {
  await mkdir(LOGS_DIR, { recursive: true })

  const id = newTraceId()
  const file = tracePath(id)

  return new Trace<TraceEvent>({
    write(content) {
      return appendFile(file, content, "utf-8")
    }
  })
}
