import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createLogServer } from "../index"
import { join } from "node:path"
import { rm, readFile } from "node:fs/promises"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"

const TEST_DIR = join(process.cwd(), "tmp", "test-logs")

describe("log-server", () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
    server = createLogServer(TEST_DIR)
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve())
    })
    const address = server.address() as AddressInfo
    baseUrl = `http://localhost:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  it("supports CORS OPTIONS preflight", async () => {
    const res = await fetch(`${baseUrl}/api/ai-log`, {
      method: "OPTIONS",
    })
    expect(res.status).toBe(204)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS")
  })

  it("returns 404 for invalid path or method", async () => {
    const resGet = await fetch(`${baseUrl}/api/ai-log`, { method: "GET" })
    expect(resGet.status).toBe(404)

    const resPost = await fetch(`${baseUrl}/invalid`, { method: "POST" })
    expect(resPost.status).toBe(404)
  })

  it("logs with default type jsonl and no namespace", async () => {
    const sessionId = "session-no-ns"
    const dataPayload = { role: "user", text: "hello no namespace" }

    const res = await fetch(`${baseUrl}/api/ai-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        data: dataPayload,
      }),
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)

    // Verify file content
    const filepath = join(TEST_DIR, `${sessionId}.jsonl`)
    const content = await readFile(filepath, "utf-8")
    expect(JSON.parse(content.trim())).toEqual(dataPayload)
  })

  it("logs with namespace and default type jsonl", async () => {
    const namespace = "proj-a"
    const sessionId = "session-ns"
    const dataPayload = { role: "assistant", text: "hello namespace" }

    const res = await fetch(`${baseUrl}/api/ai-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        namespace,
        sessionId,
        data: dataPayload,
      }),
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)

    const filepath = join(TEST_DIR, namespace, `${sessionId}.jsonl`)
    const content = await readFile(filepath, "utf-8")
    expect(JSON.parse(content.trim())).toEqual(dataPayload)
  })

  it("logs with namespace and type json, supporting multiple sequential logs in the same session", async () => {
    const namespace = "proj-b"
    const sessionId = "session-json"
    const data1 = { index: 1, val: "first" }
    const data2 = { index: 2, val: "second" }

    // First write
    const res1 = await fetch(`${baseUrl}/api/ai-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        namespace,
        sessionId,
        type: "json",
        data: data1,
      }),
    })
    expect(res1.status).toBe(200)

    const filepath = join(TEST_DIR, namespace, `${sessionId}.json`)
    let content = await readFile(filepath, "utf-8")
    let list = JSON.parse(content)
    expect(list).toEqual([data1])

    // Second write
    const res2 = await fetch(`${baseUrl}/api/ai-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        namespace,
        sessionId,
        type: "json",
        data: data2,
      }),
    })
    expect(res2.status).toBe(200)

    content = await readFile(filepath, "utf-8")
    list = JSON.parse(content)
    expect(list).toEqual([data1, data2])
  })

  it("fails with 400 when sessionId is missing", async () => {
    const res = await fetch(`${baseUrl}/api/ai-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: { test: 1 },
      }),
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toContain("sessionId")
  })

  it("fails with 400 when type is invalid", async () => {
    const res = await fetch(`${baseUrl}/api/ai-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "invalid-type-session",
        type: "csv",
        data: { test: 1 },
      }),
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toContain("Type must be")
  })

  it("fails with 400 when sessionId contains unsafe path characters", async () => {
    const res = await fetch(`${baseUrl}/api/ai-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "../attack",
        data: { test: 1 },
      }),
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  it("fails with 400 when namespace contains unsafe path characters", async () => {
    const res = await fetch(`${baseUrl}/api/ai-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        namespace: "../unsafe-ns",
        sessionId: "session-unsafe",
        data: { test: 1 },
      }),
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  it("supports legacy structure fallback (logs full payload when data is not provided)", async () => {
    const sessionId = "session-legacy"
    const payload = {
      sessionId,
      role: "system",
      prompt: "test",
    }

    const res = await fetch(`${baseUrl}/api/ai-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)

    const filepath = join(TEST_DIR, `${sessionId}.jsonl`)
    const content = await readFile(filepath, "utf-8")
    expect(JSON.parse(content.trim())).toEqual(payload)
  })

  it("successfully writes via logToServer client function", async () => {
    const { logToServer } = await import("../client")
    const sessionId = "session-client-func"
    const data = { index: 100, text: "client helper test" }

    const res = await logToServer(data, {
      serverUrl: `${baseUrl}/api/ai-log`,
      namespace: "client-ns",
      sessionId,
      type: "jsonl",
    })

    expect(res.ok).toBe(true)

    const filepath = join(TEST_DIR, "client-ns", `${sessionId}.jsonl`)
    const content = await readFile(filepath, "utf-8")
    expect(JSON.parse(content.trim())).toEqual(data)
  })
})

