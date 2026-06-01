import type { GmailLabel } from "agent"
import { isObject, safeCall, state, stringValue } from "../state"

export const systemLabels: GmailLabel[] = [
  { id: "INBOX", name: "Inbox", type: "system" },
  { id: "UNREAD", name: "Unread", type: "system" },
  { id: "STARRED", name: "Starred", type: "system" },
  { id: "IMPORTANT", name: "Important", type: "system" },
  { id: "SENT", name: "Sent", type: "system" },
  { id: "DRAFT", name: "Drafts", type: "system" },
  { id: "TRASH", name: "Trash", type: "system" },
  { id: "SPAM", name: "Spam", type: "system" },
  { id: "CATEGORY_PERSONAL", name: "Personal", type: "system" },
  { id: "CATEGORY_SOCIAL", name: "Social", type: "system" },
  { id: "CATEGORY_PROMOTIONS", name: "Promotions", type: "system" },
  { id: "CATEGORY_UPDATES", name: "Updates", type: "system" },
  { id: "CATEGORY_FORUMS", name: "Forums", type: "system" },
  { id: "^i", name: "Inbox", type: "system" },
  { id: "^u", name: "Unread", type: "system" },
  { id: "^f", name: "Sent", type: "system" },
  { id: "^k", name: "Trash", type: "system" },
  { id: "^s", name: "Spam", type: "system" },
  { id: "^t", name: "Starred", type: "system" },
  { id: "^all", name: "All Mail", type: "system" },
  { id: "^smartlabel_personal", name: "Personal", type: "system" },
  { id: "^smartlabel_social", name: "Social", type: "system" },
  { id: "^smartlabel_promo", name: "Promotions", type: "system" },
  { id: "^smartlabel_notification", name: "Updates", type: "system" },
  { id: "^smartlabel_group", name: "Forums", type: "system" }
]

export const systemLabelIds = [
  "INBOX",
  "UNREAD",
  "STARRED",
  "IMPORTANT",
  "SENT",
  "DRAFT",
  "TRASH",
  "SPAM"
]

export function normalizeLabelId(id: string): string {
  if (!id) return id

  if (id.startsWith("\\")) {
    const name = id.slice(1).toUpperCase()
    if (name === "INBOX") return "INBOX"
    if (name === "UNREAD") return "UNREAD"
    if (name === "STARRED") return "STARRED"
    if (name === "IMPORTANT") return "IMPORTANT"
    if (name === "SENT") return "SENT"
    if (name === "DRAFT") return "DRAFT"
    if (name === "TRASH") return "TRASH"
    if (name === "SPAM") return "SPAM"
  }

  const upper = id.toUpperCase()
  if (upper === "INBOX" || id === "^i") return "INBOX"
  if (upper === "UNREAD" || id === "^u") return "UNREAD"
  if (upper === "STARRED" || id === "^t") return "STARRED"
  if (upper === "IMPORTANT") return "IMPORTANT"
  if (upper === "SENT" || id === "^f") return "SENT"
  if (upper === "DRAFT") return "DRAFT"
  if (upper === "TRASH" || id === "^k") return "TRASH"
  if (upper === "SPAM" || id === "^s") return "SPAM"

  return id
}

export function labelIdToName(id: string): string {
  return (
    systemLabels.find((label) => label.id === id)?.name ??
    id.replace(/^\^x_/, "").replace(/^label:/, "").replace(/[_-]+/g, " ")
  )
}

export function collectVisibleLabelIds(): string[] {
  const gmail = state.gmail
  if (!gmail) return []

  const visibleEmails = safeCall(() => gmail.get.visible_emails()) ?? []
  return [
    ...new Set(
      visibleEmails.flatMap((entry) =>
        isObject(entry) && Array.isArray(entry.labels)
          ? entry.labels.map(stringValue).filter(Boolean).map(normalizeLabelId)
          : []
      )
    )
  ]
}

export function getVisibleLabelIds(messageId: string): string[] {
  const gmail = state.gmail
  if (!gmail) return []

  const visibleEmails = safeCall(() => gmail.get.visible_emails()) ?? []
  const visibleEmail = visibleEmails.find((entry) => {
    if (typeof entry === "string") return entry === messageId
    return isObject(entry) && stringValue(entry.id) === messageId
  })

  if (!isObject(visibleEmail) || !Array.isArray(visibleEmail.labels)) return []
  return visibleEmail.labels.map(stringValue).filter(Boolean).map(normalizeLabelId)
}

export function mergeLabels(labels: GmailLabel[]): GmailLabel[] {
  const merged = new Map<string, GmailLabel>()
  for (const label of labels) {
    if (label.id) merged.set(label.id, label)
  }
  return [...merged.values()]
}
