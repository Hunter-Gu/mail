import { tool as defineTool } from "aio"
import { z } from "zod"

import type { Context, GmailClientError, GmailHeader } from "../types"
import { isGmailClientError } from "../types"
import {
  decodeMessageBody,
  getLabelNameMap,
  getUserLabelIds,
  mapLabelIdsToNames,
  type DecodedGmailMessage
} from "./message"
import { summarizeIfNeeded } from "./summarize"

export const MAX_LIST_MESSAGES_LIMIT = 100

// ---------------------------------------------------------------------------
// ToolDefinition factories
// ---------------------------------------------------------------------------

export function listLabelsTool() {
  return defineTool<Context>({
    description: "List all Gmail labels including their IDs, names, and types.",
    parameters: z.object({}),
    execute: ({ ctx }) => ctx.gmail.listLabels()
  })
}

export function listMessagesTool() {
  return defineTool<Context>({
    description:
      "Search Gmail messages using a query string. Returns a compact plain-text summary with message IDs, headers, label names, and short excerpts.",
    parameters: z.object({
      query: z
        .string()
        .describe(
          "Gmail search query (e.g. 'is:unread label:inbox', 'from:github.com')"
        )
        .optional(),
      offset: z
        .number()
        .int()
        .min(0)
        .describe(
          "Zero-based result offset to start from. Use 0 for the first result and 50 for results 51-100."
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_LIST_MESSAGES_LIMIT)
        .describe(`Max messages to summarize (max ${MAX_LIST_MESSAGES_LIMIT})`)
    }),
    execute: ({ ctx }, args) =>
      listMessages(ctx, args.query, args.offset, args.limit)
  })
}

export function getMessageTool() {
  return defineTool<Context>({
    description:
      "Get the full content of a Gmail message: sender, subject, date, and decoded body text. Long bodies may be summarized.",
    parameters: z.object({
      messageId: z.string().describe("The Gmail message ID")
    }),
    execute: async ({ ctx }, args) => getMessage(ctx, args.messageId, true)
  })
}

export function getMessageMetadataTool() {
  return defineTool<Context>({
    description:
      "Get Gmail message metadata only (headers, label names, snippet). Does not include body content.",
    parameters: z.object({
      messageId: z.string().describe("The Gmail message ID")
    }),
    execute: ({ ctx }, args) => getMessage(ctx, args.messageId)
  })
}

/** Optional callback invoked after a successful modify, useful for logging or task-queue updates. */
export function modifyMessageTool(
  onModified?: (
    id: string,
    add: string[],
    remove: string[],
    reason: string
  ) => Promise<void> | void
) {
  return defineTool<Context>({
    description:
      "Apply supported Gmail label changes. Use to mark unread (add UNREAD), mark read (remove UNREAD), star (add STARRED), unstar (remove STARRED), archive (remove INBOX), or remove existing labels. Do not use to add user labels; WXT will notify the user and return a non-retryable error for unsupported label additions.",
    parameters: z.object({
      messageId: z.string().describe("The Gmail message ID"),
      addLabelIds: z.array(z.string()).describe("Label IDs to add").optional(),
      removeLabelIds: z
        .array(z.string())
        .describe("Label IDs to remove")
        .optional(),
      reason: z.string().describe("Brief reason for this change").optional()
    }),
    execute: async ({ ctx }, args) => {
      const id = args.messageId
      const add = args.addLabelIds ?? []
      const remove = args.removeLabelIds ?? []
      const reason = args.reason ?? ""
      const result = await modifyMessage(ctx, id, add, remove)
      if (!isGmailClientError(result)) {
        await onModified?.(id, add, remove, reason)
      }
      return result
    }
  })
}

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

export async function getMessage(
  ctx: Context,
  messageId: string,
  includeBody = false
) {
  const decoded = await getMessageDecoded(ctx, messageId)
  if (!decoded || isGmailClientError(decoded)) return decoded

  if (!includeBody) {
    delete decoded.body
  }

  const body = stringValue(decoded.body)
  if (!body) return decoded

  const summarized = await summarizeIfNeeded(ctx, body)
  return { ...decoded, body: summarized }
}

export async function listMessages(
  ctx: Context,
  query: string | undefined,
  offsetArg: number,
  limitArg: number
): Promise<string> {
  const offset = Number.isFinite(offsetArg)
    ? Math.max(Math.floor(offsetArg), 0)
    : 0
  const limit = Number.isFinite(limitArg)
    ? Math.min(Math.max(Math.floor(limitArg), 1), MAX_LIST_MESSAGES_LIMIT)
    : 1
  const raw = await ctx.gmail.listMessages(query, offset, limit)

  if (isGmailClientError(raw)) {
    return [`Gmail search failed: ${raw.error}`, raw.stderr ?? ""]
      .filter(Boolean)
      .join("\n")
  }

  const messages = (raw.messages ?? []).slice(0, limit)
  const estimate =
    typeof raw.resultSizeEstimate === "number"
      ? `About ${raw.resultSizeEstimate} matching messages.`
      : ""

  if (messages.length === 0) {
    return [
      `Search query: ${query || "(none)"}`,
      estimate,
      "No messages matched this search."
    ]
      .filter(Boolean)
      .join("\n")
  }

  const keywords = extractQueryKeywords(query)
  const lines = [
    `Search query: ${query || "(none)"}`,
    `Returned ${messages.length} message${messages.length === 1 ? "" : "s"} from offset ${offset}.`,
    estimate,
    keywords.length > 0 ? `Excerpt keywords: ${keywords.join(", ")}` : "",
    ""
  ].filter(Boolean)

  for (const [index, message] of messages.entries()) {
    const id = message.id.trim()
    const threadId = message.threadId.trim()
    const summary = await summarizeMessage(ctx, id, keywords)

    lines.push(`${index + 1}. ${summary.subject || "(no subject)"}`)
    lines.push(`   id: ${id || "(missing)"}`)
    if (threadId) lines.push(`   thread: ${threadId}`)
    if (summary.from) lines.push(`   from: ${summary.from}`)
    if (summary.date) lines.push(`   date: ${summary.date}`)
    if (summary.labels.length > 0)
      lines.push(`   labels: ${summary.labels.join(", ")}`)
    lines.push(`   excerpt: ${summary.excerpt || "(no preview available)"}`)
    lines.push("")
  }

  return lines.join("\n").trim()
}

export async function modifyMessage(
  ctx: Context,
  messageId: string,
  addLabelIds: string[],
  removeLabelIds: string[]
) {
  const result = await ctx.gmail.updateLabels(
    messageId,
    addLabelIds,
    removeLabelIds
  )
  if (isGmailClientError(result)) return result

  // Filter to user labels only, then decode into the same clean shape as getMessage
  const userLabelIds = await getUserLabelIds(ctx)
  const filtered = {
    ...result,
    labelIds: Array.isArray(result.labelIds)
      ? result.labelIds.filter((id) => userLabelIds.has(id))
      : result.labelIds
  }

  return decodeMessageBody(ctx, filtered)
}

async function summarizeMessage(
  ctx: Context,
  messageId: string,
  keywords: string[]
) {
  if (!messageId) {
    return { from: "", subject: "", date: "", labels: [], excerpt: "" }
  }

  const metadata = await ctx.gmail.getMessageMetadata(messageId)
  if (!metadata || isGmailClientError(metadata)) {
    return {
      from: "",
      subject: "",
      date: "",
      labels: [],
      excerpt:
        metadata && isGmailClientError(metadata)
          ? `Could not load metadata: ${metadata.error}`
          : ""
    }
  }

  const headers = metadata.payload?.headers

  const snippet = stringValue(metadata.snippet)
  let excerpt = makeExcerpt(snippet, keywords)

  if (keywords.length > 0 && !containsAny(snippet, keywords)) {
    const full = await getMessageDecoded(ctx, messageId)
    const body = full && !isGmailClientError(full) ? stringValue(full.body) : ""
    excerpt = makeExcerpt(body || snippet, keywords)
  }

  const labelIds = Array.isArray(metadata.labelIds)
    ? metadata.labelIds.map((id) => id.trim()).filter(Boolean)
    : []
  const labels =
    labelIds.length > 0
      ? mapLabelIdsToNames(labelIds, await getLabelNameMap(ctx))
      : []

  return {
    from: readHeader(headers, "From"),
    subject: readHeader(headers, "Subject"),
    date: readHeader(headers, "Date"),
    labels,
    excerpt
  }
}

async function getMessageDecoded(
  ctx: Context,
  messageId: string
): Promise<DecodedGmailMessage | GmailClientError | null> {
  const raw = await ctx.gmail.getMessage(messageId)
  if (!raw || isGmailClientError(raw)) return raw
  const result = decodeMessageBody(ctx, raw)
  return result
}

function extractQueryKeywords(query?: string): string[] {
  if (!query) return []

  const quoted = [...query.matchAll(/"([^"]+)"/g)].map((match) => match[1])
  const withoutQuoted = query.replace(/"([^"]+)"/g, " ")
  const bare = withoutQuoted
    .split(/\s+/)
    .filter((token) => token && !token.includes(":"))
    .filter((token) => !["and", "or", "not"].includes(token.toLowerCase()))

  return [...quoted, ...bare]
    .flatMap((term) => term.split(/\s+/))
    .map((term) => term.replace(/^[^\w]+|[^\w]+$/g, ""))
    .filter((term) => term.length >= 3)
    .slice(0, 8)
}

function makeExcerpt(
  text: string,
  keywords: string[],
  maxLength = 360
): string {
  const normalized = normalizeWhitespace(text)
  if (!normalized) return ""
  if (normalized.length <= maxLength) return normalized

  const lower = normalized.toLowerCase()
  const matchIndex = keywords
    .map((keyword) => lower.indexOf(keyword.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0]

  if (matchIndex === undefined) {
    return `${normalized.slice(0, maxLength).trim()}...`
  }

  const start = Math.max(0, matchIndex - 120)
  const end = Math.min(normalized.length, matchIndex + maxLength - 120)
  const prefix = start > 0 ? "..." : ""
  const suffix = end < normalized.length ? "..." : ""
  return `${prefix}${normalized.slice(start, end).trim()}${suffix}`
}

function containsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase()
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()))
}

function readHeader(headers: GmailHeader[] | undefined, name: string): string {
  return (
    headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  )
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
