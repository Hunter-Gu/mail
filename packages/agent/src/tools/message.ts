/**
 * Shared Gmail message-decoding utilities.
 * Previously duplicated in tools/gmail and agents/onboarding.
 */
import type { Context, GmailLabel, GmailMessage, LabelMap } from "../types"
import { isGmailClientError } from "../types"
import { extractBody } from "./mime"

export { extractBody } from "./mime"

export type DecodedGmailMessage = {
  id?: string
  threadId?: string
  labels: string[]
  from?: string
  to?: string
  subject?: string
  date?: string
  body?: string
  [key: string]: unknown
}

const LABEL_MAP_TTL_MS = 5 * 60 * 1000
let labelMapCache: { map: LabelMap; updatedAt: number } | null = null

export async function getLabelNameMap(ctx: Context) {
  const now = Date.now()
  if (labelMapCache && now - labelMapCache.updatedAt < LABEL_MAP_TTL_MS)
    return labelMapCache.map

  const raw = await ctx.gmail.listLabels()
  const labels = parseLabelList(raw)

  const map = new Map<string, string>()
  for (const label of labels) {
    const id = stringValue(label.id)
    const name = stringValue(label.name)
    if (id && name) map.set(id, name)
  }

  labelMapCache = { map, updatedAt: now }
  return map
}

/** Returns a Set of label IDs that are user-created (not system labels). */
export async function getUserLabelIds(ctx: Context) {
  const raw = await ctx.gmail.listLabels()
  const labels = parseLabelList(raw)

  return new Set(
    labels
      .filter((label) => stringValue(label.type) === "user")
      .map((label) => stringValue(label.id))
      .filter(Boolean)
  )
}

function parseLabelList(
  raw: Awaited<ReturnType<Context["gmail"]["listLabels"]>>
): GmailLabel[] {
  if (isGmailClientError(raw)) {
    return []
  }
  return raw.labels ?? []
}

export function mapLabelIdsToNames(
  labelIds: string[],
  labelMap: LabelMap
): string[] {
  return labelIds
    .map((id) => labelMap.get(id))
    .filter((name): name is string => Boolean(name))
}

export async function decodeMessageBody(
  ctx: Context,
  msg: GmailMessage
): Promise<DecodedGmailMessage> {
  const payload = msg.payload
  const labelIds = Array.isArray(msg.labelIds)
    ? msg.labelIds.map((id) => id.trim()).filter(Boolean)
    : []
  const labels =
    labelIds.length > 0
      ? mapLabelIdsToNames(labelIds, await getLabelNameMap(ctx))
      : []

  if (!payload) {
    const clone: Record<string, unknown> = { ...msg }
    if (labels.length > 0) clone.labels = labels
    delete clone.labelIds
    return {
      ...clone,
      labels
    }
  }

  const headers = payload.headers ?? []
  const get = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
    ""

  return {
    id: msg.id,
    threadId: msg.threadId,
    labels,
    from: get("From"),
    to: get("To"),
    subject: get("Subject"),
    date: get("Date"),
    body: extractBody(payload)
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

// extractBody is provided by ./mime (recursive MIME tree parser with HTML fallback)
