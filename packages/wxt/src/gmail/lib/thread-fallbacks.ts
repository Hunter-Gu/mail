import {
  activeThreadIds,
  delay,
  isObject,
  safeCall,
  state,
  stringValue,
  type CachedMessageData
} from "../state"
import { isVisible } from "./dom"
import type { VisibleEmail } from "./types"

export function getVisibleThreadIdsFromDom(): string[] {
  const ids = new Set<string>()

  for (const row of getVisibleThreadRows()) {
    const rowId = row.getAttribute("data-thread-id") || row.getAttribute("data-legacy-thread-id")
    if (rowId && /^[0-9a-fA-F]{16}$/.test(rowId)) {
      ids.add(rowId)
      continue
    }

    const links = row.querySelectorAll("a[href]")
    for (const link of Array.from(links)) {
      const href = link.getAttribute("href") || ""
      const match = href.match(/#\w+(?:\/[\w\-:;%]+)*\/([0-9a-fA-F]{16})/)
      if (match && match[1]) {
        ids.add(match[1])
        break
      }

      const hexMatch = href.match(/\/([0-9a-fA-F]{16})(?:\?|$)/)
      if (hexMatch && hexMatch[1]) {
        ids.add(hexMatch[1])
        break
      }
    }
  }

  return Array.from(ids)
}

export function getVisibleThreadRows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        "tr.zA",
        '[role="main"] [role="row"][data-thread-id]',
        '[role="main"] [role="row"][data-legacy-thread-id]'
      ].join(", ")
    )
  ).filter(isVisible)
}

export async function waitForNewVisiblePageIds(
  existingIds: string[],
  timeoutMs: number,
  intervalMs: number
): Promise<string[] | null> {
  const existing = new Set(existingIds)
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ids = collectVisiblePageThreadIds()
    if (ids.some((id) => !existing.has(id))) return ids
    await delay(intervalMs)
  }
  return null
}

export function collectVisiblePageThreadIds(): string[] {
  const ids: string[] = []
  appendUniqueThreadIds(ids, getGmailJsVisibleThreadIds(state.gmail))
  appendUniqueThreadIds(ids, Array.from(activeThreadIds))
  appendUniqueThreadIds(ids, getVisibleThreadIdsFromDom())
  return ids
}

export function getGmailJsVisibleThreadIds(gmail: typeof state.gmail): string[] {
  if (!gmail) return []
  const visibleEmails = safeCall(() => gmail.get.visible_emails()) ?? []
  return visibleEmails
    .map((entry) => {
      const ref = toMessageRef(entry)
      return ref ? ref.threadId : ""
    })
    .filter(isLegacyThreadId)
}

export function appendUniqueThreadIds(target: string[], incoming: string[]): number {
  const seen = new Set(target)
  let added = 0
  incoming
    .filter(isLegacyThreadId)
    .forEach((id) => {
      if (seen.has(id)) return
      seen.add(id)
      target.push(id)
      added++
    })
  return added
}

export function isLegacyThreadId(id: string): boolean {
  return /^[0-9a-f]{16}$/i.test(id)
}

export function getEmailDataFromDom(messageId: string): CachedMessageData | null {
  try {
    const subjectEl = document.querySelector("h2.hP")
    if (!subjectEl) return null

    const subject = subjectEl.textContent?.trim() || ""
    const messages = document.querySelectorAll("div.adn")
    if (messages.length === 0) return null

    const lastMsg = messages[messages.length - 1]

    const senderEl = lastMsg.querySelector("span.gD")
    const senderName = senderEl?.getAttribute("name") || ""
    const senderEmail = senderEl?.getAttribute("email") || ""
    const from = senderName ? `"${senderName}" <${senderEmail}>` : senderEmail

    const dateEl = lastMsg.querySelector("span.g3")
    const date = dateEl?.getAttribute("title") || dateEl?.textContent?.trim() || ""

    const bodyEl = lastMsg.querySelector<HTMLElement>("div.a3s")
    const body = bodyEl ? bodyEl.innerText || bodyEl.textContent || "" : ""

    const recipientEl = lastMsg.querySelector("span.hb span[email]") || lastMsg.querySelector("span[email]")
    const to = recipientEl?.getAttribute("email") || ""

    const labels: string[] = []
    const header = document.querySelector(".ha, .hE, .gK")
    if (header) {
      const chips = header.querySelectorAll("div[role='gridcell'], div.at, span.yi")
      chips.forEach((chip) => {
        const text = chip.textContent?.trim()
        if (text && text.length < 50) {
          labels.push(text)
        }
      })
    }

    return {
      id: messageId,
      threadId: messageId,
      subject,
      from,
      to,
      date,
      body,
      labels
    }
  } catch (err) {
    console.error("[messages] Error scraping email from DOM:", err)
    return null
  }
}

export function openThreadFromDomFallback(messageId: string): void {
  let rowToClick: HTMLElement | null = null
  const rows = document.querySelectorAll("tr.zA")
  for (const row of Array.from(rows)) {
    const rowId = row.getAttribute("data-thread-id") || row.getAttribute("data-legacy-thread-id")
    if (rowId === messageId) {
      rowToClick = row as HTMLElement
      break
    }
    const links = row.querySelectorAll("a[href]")
    for (const link of Array.from(links)) {
      const href = link.getAttribute("href") || ""
      if (href.includes(messageId)) {
        rowToClick = row as HTMLElement
        break
      }
    }
    if (rowToClick) break
  }

  if (rowToClick) {
    rowToClick.click()
    return
  }

  const link = document.querySelector(`a[href*="${messageId}"]`) as HTMLElement | null
  if (link) {
    link.click()
  } else {
    window.location.hash = "#all/" + messageId
  }
}

export function toMessageRef(
  entry: string | VisibleEmail
): { id: string; threadId: string } | null {
  if (typeof entry === "string") {
    return entry ? { id: entry, threadId: entry } : null
  }

  if (!isObject(entry)) return null

  const id = stringValue(entry.id)
  if (!id) return null

  const threadId =
    stringValue(entry.threadId) || stringValue(entry.thread_id) || id
  return { id, threadId }
}
