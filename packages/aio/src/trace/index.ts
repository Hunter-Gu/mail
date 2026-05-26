import type { MaybePromise, TraceWriter } from "./types"

export * from "./types"

function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString()
  if (value instanceof Date) return value.toISOString()

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    }
  }

  if (Array.isArray(value)) return value.map(normalizeValue)

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, normalizeValue(child)])
    )
  }

  return value
}

export function jsonLine(record: object) {
  return JSON.stringify(record)
}

function isPromiseLike(value: MaybePromise<void>): value is Promise<void> {
  return Boolean(value && typeof (value as Promise<void>).then === "function")
}

export class Trace<Data extends object = Record<string, unknown>> {
  private readonly lines: string[] = []
  private readonly pendingWrites: Promise<void>[] = []
  private readonly serialize = jsonLine

  constructor(private readonly options: TraceWriter) {}

  write(event: Data) {
    const eventFields = { ...(normalizeValue(event) as Data) }

    const content = `${this.serialize({
      ...eventFields
    })}\n`
    if (this.options.batch) {
      this.lines.push(content)
    } else {
      const pending = this.options.write(content)
      if (isPromiseLike(pending)) {
        this.pendingWrites.push(Promise.resolve(pending))
      }
    }
  }

  async flush() {
    if (this.pendingWrites.length > 0) {
      await Promise.all(this.pendingWrites.splice(0))
    }

    if (this.lines.length === 0) return

    const content = this.lines.join("")
    await this.options.write(content)
    this.lines.length = 0
  }
}
