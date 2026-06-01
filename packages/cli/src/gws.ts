import { spawnSync, type StdioOptions } from "node:child_process"
import type {
  GmailClient,
  GmailClientError,
  GmailHeader,
  GmailLabel,
  GmailListLabelsResponse,
  GmailListMessagesResponse,
  GmailMessage,
  GmailMessagePart,
  GmailMessagePartBody,
  GmailMessageRef
} from "agent"

interface GwsCommandResult {
  status: number | null
  stdout: string
  stderr: string
  error?: string
}

export function runGwsCommand(
  args: string[],
  options: { stdio?: StdioOptions } = {}
): GwsCommandResult {
  const result = spawnSync("gws", args, {
    encoding: "utf-8",
    env: process.env,
    stdio: options.stdio
  })

  return {
    status: result.status,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
    error: result.error?.message
  }
}

export function createGwsGmailClient(): GmailClient {
  return {
    listMessages: (query, offset, limit) => listMessages(query, offset, limit),
    getMessage: (messageId) => getMessage(messageId, "full"),
    getMessageMetadata: (messageId) => getMessage(messageId, "metadata"),
    listLabels,
    updateLabels
  }
}

function runGws(args: string[]): unknown {
  const result = runGwsCommand(args)

  if (result.error) {
    return { error: result.error }
  }

  if (result.status !== 0) {
    return { error: `gws exited with code ${result.status}`, stderr: result.stderr }
  }

  try {
    return JSON.parse(result.stdout)
  } catch {
    return { error: "gws returned non-JSON output", stderr: result.stdout }
  }
}

function listMessages(
  query: string | undefined,
  offset: number,
  limit: number
): GmailListMessagesResponse | GmailClientError {
  const response: GmailListMessagesResponse = {}
  const targetEnd = offset + limit
  const allMessages: GmailMessageRef[] = []
  let pageToken: string | undefined
  let nextPageToken: string | undefined
  let resultSizeEstimate: number | undefined

  while (allMessages.length < targetEnd) {
    const params: Record<string, unknown> = {
      userId: "me",
      maxResults: Math.min(500, Math.max(1, targetEnd - allMessages.length))
    }
    if (query) params.q = query
    if (pageToken) params.pageToken = pageToken

    const raw = runGws([
      "gmail",
      "users",
      "messages",
      "list",
      "--params",
      JSON.stringify(params)
    ])
    const error = parseError(raw)
    if (error) return error
    if (!isRecord(raw)) return { error: "Invalid Gmail list response." }

    allMessages.push(...parseMessageRefs(raw.messages))
    if (typeof raw.resultSizeEstimate === "number") {
      resultSizeEstimate = raw.resultSizeEstimate
    }
    nextPageToken = typeof raw.nextPageToken === "string" && raw.nextPageToken.length > 0
      ? raw.nextPageToken
      : undefined
    if (!nextPageToken) {
      break
    }
    pageToken = nextPageToken
  }

  const messages = allMessages.slice(offset, targetEnd)
  if (messages.length > 0) response.messages = messages
  if (nextPageToken) response.nextPageToken = nextPageToken
  if (typeof resultSizeEstimate === "number") {
    response.resultSizeEstimate = resultSizeEstimate
  }
  return response
}

function getMessage(
  messageId: string,
  format: "full" | "metadata"
): GmailMessage | GmailClientError {
  const params: Record<string, unknown> = {
    userId: "me",
    id: messageId,
    format
  }
  if (format === "metadata") {
    params.metadataHeaders = ["From", "Subject", "Date"]
  }

  const raw = runGws([
    "gmail",
    "users",
    "messages",
    "get",
    "--params",
    JSON.stringify(params)
  ])
  const error = parseError(raw)
  if (error) return error
  return parseMessage(raw) ?? { error: "Invalid Gmail message response." }
}

function listLabels(): GmailListLabelsResponse | GmailClientError {
  const raw = runGws([
    "gmail",
    "users",
    "labels",
    "list",
    "--params",
    JSON.stringify({ userId: "me" })
  ])
  const error = parseError(raw)
  if (error) return error
  if (!isRecord(raw)) return { error: "Invalid Gmail labels response." }

  return { labels: parseLabels(raw.labels) }
}

function updateLabels(
  messageId: string,
  addLabelIds: string[] = [],
  removeLabelIds: string[] = []
): GmailMessage | GmailClientError {
  const raw = runGws([
    "gmail",
    "users",
    "messages",
    "modify",
    "--params",
    JSON.stringify({ userId: "me", id: messageId }),
    "--json",
    JSON.stringify({ addLabelIds, removeLabelIds })
  ])
  const error = parseError(raw)
  if (error) return error
  return parseMessage(raw) ?? { error: "Invalid Gmail modify response." }
}

function parseError(raw: unknown): GmailClientError | null {
  if (!isRecord(raw) || typeof raw.error !== "string") return null
  return {
    error: raw.error,
    stderr: typeof raw.stderr === "string" ? raw.stderr : undefined
  }
}

function parseMessageRefs(value: unknown): GmailMessageRef[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const id = stringValue(item.id)
    const threadId = stringValue(item.threadId)
    return id && threadId ? [{ id, threadId }] : []
  })
}

function parseLabels(value: unknown): GmailLabel[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const id = stringValue(item.id)
    const name = stringValue(item.name)
    if (!id || !name) return []

    const label: GmailLabel = { id, name }
    const type = stringValue(item.type)
    if (type) label.type = type
    const messageListVisibility = stringValue(item.messageListVisibility)
    if (messageListVisibility) {
      label.messageListVisibility = messageListVisibility
    }
    const labelListVisibility = stringValue(item.labelListVisibility)
    if (labelListVisibility) {
      label.labelListVisibility = labelListVisibility
    }
    return [label]
  })
}

function parseMessage(value: unknown): GmailMessage | null {
  if (!isRecord(value)) return null

  const message: GmailMessage = {}
  const id = stringValue(value.id)
  if (id) message.id = id
  const threadId = stringValue(value.threadId)
  if (threadId) message.threadId = threadId
  const labelIds = stringArray(value.labelIds)
  if (labelIds.length > 0) message.labelIds = labelIds
  const snippet = stringValue(value.snippet)
  if (snippet) message.snippet = snippet
  const historyId = stringValue(value.historyId)
  if (historyId) message.historyId = historyId
  const internalDate = stringValue(value.internalDate)
  if (internalDate) message.internalDate = internalDate
  if (typeof value.sizeEstimate === "number") {
    message.sizeEstimate = value.sizeEstimate
  }
  const raw = stringValue(value.raw)
  if (raw) message.raw = raw

  const payload = parseMessagePart(value.payload)
  if (payload) message.payload = payload

  return Object.keys(message).length > 0 ? message : null
}

function parseMessagePart(value: unknown): GmailMessagePart | undefined {
  if (!isRecord(value)) return undefined

  const part: GmailMessagePart = {}
  const partId = stringValue(value.partId)
  if (partId) part.partId = partId
  const mimeType = stringValue(value.mimeType)
  if (mimeType) part.mimeType = mimeType
  const filename = stringValue(value.filename)
  if (filename) part.filename = filename

  const headers = parseHeaders(value.headers)
  if (headers.length > 0) part.headers = headers

  const body = parseMessagePartBody(value.body)
  if (body) part.body = body

  const parts = Array.isArray(value.parts)
    ? value.parts.flatMap((child) => {
        const parsed = parseMessagePart(child)
        return parsed ? [parsed] : []
      })
    : []
  if (parts.length > 0) part.parts = parts

  return Object.keys(part).length > 0 ? part : undefined
}

function parseHeaders(value: unknown): GmailHeader[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const name = stringValue(item.name)
    const headerValue = stringValue(item.value)
    return name ? [{ name, value: headerValue }] : []
  })
}

function parseMessagePartBody(
  value: unknown
): GmailMessagePartBody | undefined {
  if (!isRecord(value)) return undefined

  const body: GmailMessagePartBody = {}
  const attachmentId = stringValue(value.attachmentId)
  if (attachmentId) body.attachmentId = attachmentId
  if (typeof value.size === "number") body.size = value.size
  const data = stringValue(value.data)
  if (data) body.data = data

  return Object.keys(body).length > 0 ? body : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(stringValue).filter((item) => item.length > 0)
    : []
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
