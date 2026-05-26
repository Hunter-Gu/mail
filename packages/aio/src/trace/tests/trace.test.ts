import { appendFile, mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { Trace } from "../index"

describe("Trace", () => {
  it("writes JSON lines with event fields", async () => {
    const writes: string[] = []
    const trace = new Trace({
      batch: true,
      write: (content) => {
        writes.push(content)
      }
    })

    trace.write({
      type: "message",
      role: "user",
      content: "hello",
      timestamp: new Date("2026-01-01T00:00:00.000Z"),
      tokens: 10n
    })

    expect(writes).toHaveLength(0)

    await trace.flush()

    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0])).toEqual({
      type: "message",
      role: "user",
      content: "hello",
      timestamp: "2026-01-01T00:00:00.000Z",
      tokens: "10"
    })
  })

  it("preserves explicit event fields", async () => {
    const writes: string[] = []
    const trace = new Trace({
      batch: true,
      write: (content) => {
        writes.push(content)
      }
    })

    trace.write({
      type: "message",
      name: "event-name",
      role: "assistant",
      content: "done"
    })
    await trace.flush()

    expect(JSON.parse(writes[0])).toEqual({
      type: "message",
      name: "event-name",
      role: "assistant",
      content: "done"
    })
  })

  it("appends trace events to a file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trace-test-"))
    const filePath = join(dir, "trace.ndjson")
    const trace = new Trace({
      batch: true,
      write: (content) => appendFile(filePath, content, "utf8")
    })

    trace.write({
      type: "tool-result",
      toolName: "lookup",
      output: "ok"
    })
    await trace.flush()

    expect(await readFile(filePath, "utf8")).toBe(
      '{"type":"tool-result","toolName":"lookup","output":"ok"}\n'
    )
  })

  it("flushes multiple trace events with one write", async () => {
    const writes: string[] = []
    const trace = new Trace({
      batch: true,
      write: (content) => {
        writes.push(content)
      }
    })

    trace.write({ type: "text", content: "hello" })
    trace.write({ type: "text", content: "world" })
    await trace.flush()

    expect(writes).toHaveLength(1)
    expect(writes[0].split("\n").filter(Boolean)).toHaveLength(2)

    await trace.flush()

    expect(writes).toHaveLength(1)
  })

  it("waits for immediate async writes on flush", async () => {
    const writes: string[] = []
    let resolveWrite!: () => void
    const writeReady = new Promise<void>((resolve) => {
      resolveWrite = resolve
    })
    const trace = new Trace({
      write: async (content) => {
        await writeReady
        writes.push(content)
      }
    })

    trace.write({ type: "text", content: "later" })
    const flushed = trace.flush()

    expect(writes).toHaveLength(0)

    resolveWrite()
    await flushed

    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0])).toEqual({
      type: "text",
      content: "later"
    })
  })
})
