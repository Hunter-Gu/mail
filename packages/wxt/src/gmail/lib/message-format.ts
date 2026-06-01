import type { GmailEmailData } from "gmail-js"
import type { GmailMessage } from "agent"
import { getVisibleLabelIds, normalizeLabelId } from "./label-model"

export function toGmailMessage(
  messageId: string,
  data: GmailEmailData,
  metadataOnly: boolean
): GmailMessage {
  const threadMessages = data.threads ? Object.entries(data.threads) : []
  const matchedThread =
    threadMessages.find(([id]) => id === messageId) || threadMessages[0]
  const [actualId, email] = matchedThread ?? []

  const id = actualId || data.first_email || messageId
  const threadId = data.thread_id || messageId
  const subject = data.subject || email?.subject || ""
  const from = email?.from_email || email?.from || ""
  const to = email?.to?.join(", ") ?? ""
  const date = email?.datetime || ""
  const body =
    email?.content_plain || stripHtml(email?.content_html || "")

  const rawLabels = (data as any).labels || getVisibleLabelIds(messageId) || []
  const labelIds = rawLabels.map(normalizeLabelId)

  return {
    id,
    threadId,
    labelIds,
    snippet: body.slice(0, 160),
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: from },
        { name: "To", value: to },
        { name: "Subject", value: subject },
        { name: "Date", value: date }
      ].filter((header) => header.value),
      body: metadataOnly ? undefined : { data: encodeBase64Url(body) }
    }
  }
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

export function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
