import {
  Gmail,
  type GmailCachedEmail,
  type GmailEmailData,
  type GmailThreadData
} from "gmail-js"

export default defineContentScript({
  matches: ["https://mail.google.com/*"],
  runAt: "document_start",
  world: "MAIN",
  main() {
    console.log("[gmail-main] Injected into Gmail MAIN world successfully.")
    const gmail = new Gmail(false)
    installThreadListInterceptors()

    window.addEventListener("message", async (event) => {
      // Only handle requests from our isolated world script
      if (event.data?.source !== "mail-agent-isolated") return

      const { requestId, type, payload } = event.data
      console.log(`[gmail-main] Received request: ${type} (ID: ${requestId})`)

      try {
        let result: any

        switch (type) {
          case "email_data":
            result = getCachedEmailData(gmail, payload?.messageId)
            break
          case "email_debug":
            result = getEmailDataDebug(gmail, payload?.messageId)
            break
          case "thread_list":
            result = getCachedThreadList(payload)
            break
          case "labels":
            result = getVisibleLabelNames()
            break
          case "labels_omni":
            result = await getOmniLabelCatalog()
            break
          case "snapshot":
            const threadDetailVisible = hasVisibleThreadDetail()
            result = {
              page: safeCall(() => gmail.get.current_page()) || getCurrentPage(),
              threadDetailVisible,
              threadId: threadDetailVisible
                ? safeCall(() => gmail.new.get.thread_id()) || getThreadId()
                : "",
              emailId: threadDetailVisible
                ? safeCall(() => gmail.new.get.email_id()) || getEmailId()
                : "",
              subject: getSubject(),
              visibleMessageCount: getVisibleMessageCount()
            }
            break
          default:
            throw new Error(`Unknown main world request type: ${type}`)
        }

        window.postMessage({
          source: "mail-agent-main",
          requestId,
          payload: result
        }, "*")
      } catch (err) {
        console.error(`[gmail-main] Error processing ${type}:`, err)
        window.postMessage({
          source: "mail-agent-main",
          requestId,
          error: err instanceof Error ? err.message : String(err)
        }, "*")
      }
    })
  }
})

type GmailOmniLabel = {
  id: string
  name: string
  type: "user"
}

type OmniLabelCatalogResult = {
  labels: GmailOmniLabel[]
  complete: boolean
  source?: string
  error?: string
}

type ThreadListCacheEntry = {
  threadIds: string[]
  source: string
  capturedAt: number
  route: string
}

const threadListCache: ThreadListCacheEntry[] = []
const threadListAttempts: Array<{
  source: string
  capturedAt: number
  responseLength: number
  threadCount: number
  error?: string
}> = []
let threadListInterceptorsInstalled = false

function getCurrentPage(): string {
  const hashPart = window.location.hash.split("#").pop()?.split("?").shift()
  if (!hashPart) return "inbox"
  return /\/[0-9a-zA-Z]{16,}$/i.test(hashPart)
    ? "email"
    : hashPart.split("/").slice(0, 2).join("/")
}

function getThreadId(): string {
  if (!hasVisibleThreadDetail()) return ""
  const detailIdElement = getCurrentDetailIdElement()
  return (
    document.querySelector<HTMLElement>("[data-thread-perm-id]")?.dataset.threadPermId ||
    detailIdElement?.dataset.legacyThreadId ||
    detailIdElement?.dataset.threadId ||
    ""
  )
}

function getEmailId(): string {
  if (!hasVisibleThreadDetail()) return ""
  const messages = document.querySelectorAll<HTMLElement>(".adn[data-message-id]")
  const latest = messages[messages.length - 1]
  return latest?.dataset.messageId?.replace(/^#/, "") || ""
}

function getSubject(): string {
  const visibleSubjects = Array.from(document.querySelectorAll<HTMLElement>("h2.hP"))
  return visibleSubjects.find(isVisible)?.textContent?.trim() || ""
}

function hasVisibleThreadDetail(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>("h2.hP, div.adn"))
    .some(isVisible)
}

function getCurrentDetailIdElement(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(
    "[data-legacy-thread-id], [data-thread-id]"
  ))
  return candidates.find((el) =>
    !el.closest("tr.zA, [role='row']") &&
    Boolean(el.closest("main, [role='main'], div.adn, div.if, div.iY"))
  ) || null
}

function getVisibleMessageCount(): number {
  const openMessages = document.querySelectorAll("div.adn").length
  if (openMessages > 0) return openMessages

  const threadIds = new Set<string>()
  document.querySelectorAll<HTMLElement>("tr.zA").forEach((row) => {
    const id = row.dataset.threadId || row.dataset.legacyThreadId
    if (id) threadIds.add(id)
  })
  document.querySelectorAll<HTMLElement>("[data-thread-id]").forEach((el) => {
    const id = el.dataset.threadId
    if (id) threadIds.add(id)
  })
  return threadIds.size
}

function getVisibleLabelNames(): string[] {
  const labels = new Set<string>()
  document
    .querySelectorAll<HTMLElement>("div.hN, div.at, span.yi, a[href*='#label/']")
    .forEach((el) => {
      const text = el.textContent?.replace(/\(\d+\)$/, "").trim()
      if (text && text.length < 80) labels.add(text)
    })
  return Array.from(labels)
}

function installThreadListInterceptors(): void {
  if (threadListInterceptorsInstalled) return
  threadListInterceptorsInstalled = true

  const originalFetch = window.fetch.bind(window)
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init)
    const url = requestUrlFromFetchInput(input)
    if (isThreadListResponseUrl(url)) {
      response.clone().text()
        .then((text) => captureThreadListResponse(url, text))
        .catch((err) => console.debug("[gmail-main] Failed to inspect fetch thread list response:", err))
    }
    return response
  }) as typeof window.fetch

  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function(
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ) {
    ;(this as XMLHttpRequest & { __mailAgentUrl?: string }).__mailAgentUrl = String(url)
    const args = [method, url, async, username, password]
      .slice(0, arguments.length) as [
        string,
        string | URL,
        boolean?,
        (string | null)?,
        (string | null)?
      ]
    return (originalOpen as (...args: unknown[]) => void).apply(this, args)
  }
  XMLHttpRequest.prototype.send = function(body?: Document | XMLHttpRequestBodyInit | null) {
    this.addEventListener("loadend", () => {
      const url = (this as XMLHttpRequest & { __mailAgentUrl?: string }).__mailAgentUrl || this.responseURL
      if (!isThreadListResponseUrl(url) || this.status !== 200) return

      const text = safeCall(() => this.responseText) ||
        (typeof this.response === "string" ? this.response : "")
      if (text) {
        captureThreadListResponse(url, text)
      } else {
        rememberThreadListAttempt({
          source: responseSourceName(url),
          capturedAt: Date.now(),
          responseLength: 0,
          threadCount: 0,
          error: `matched response but could not read text responseType=${this.responseType || "text"}`
        })
      }
    })
    return originalSend.call(this, body)
  }
}

function requestUrlFromFetchInput(input: RequestInfo | URL): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.href
  return input.url
}

function isThreadListResponseUrl(url: string): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url, window.location.origin)
    if (parsed.hostname !== "mail.google.com") return false
    return /\/sync(?:\/u\/\d+)?\/i\/(?:bv|fd)(?:[/?#]|$)/.test(parsed.pathname) ||
      parsed.searchParams.get("view") === "tl"
  } catch {
    return /\/sync(?:\/u\/\d+)?\/i\/(?:bv|fd)(?:[/?#]|$)/.test(url) || /[?&]view=tl(?:&|$)/.test(url)
  }
}

function captureThreadListResponse(url: string, text: string): void {
  const source = responseSourceName(url)
  const threadIds = extractThreadIdsFromListResponse(url, text)
  const usableForList = isUsableThreadListCandidate(url, threadIds)
  rememberThreadListAttempt({
    source,
    capturedAt: Date.now(),
    responseLength: text.length,
    threadCount: threadIds.length,
    error: threadIds.length === 0
      ? "matched response but extracted no thread ids"
      : usableForList
        ? undefined
        : "matched thread-data response but treated it as non-list because it only contained one thread"
  })
  if (!usableForList) return

  const entry: ThreadListCacheEntry = {
    threadIds,
    source,
    capturedAt: Date.now(),
    route: window.location.hash || getCurrentPage()
  }
  threadListCache.push(entry)
  threadListCache.splice(0, Math.max(0, threadListCache.length - 25))
  console.log(`[gmail-main] Cached ${threadIds.length} thread ids from ${entry.source}.`)
}

function getCachedThreadList(payload?: { since?: number; maxAgeMs?: number }) {
  const now = Date.now()
  const maxAgeMs = typeof payload?.maxAgeMs === "number" ? payload.maxAgeMs : 45000
  const since = typeof payload?.since === "number" ? payload.since : 0
  const currentRoute = window.location.hash || getCurrentPage()
  const candidates = threadListCache
    .slice()
    .reverse()
    .filter((candidate) =>
      candidate.threadIds.length > 0 &&
      candidate.capturedAt >= since &&
      now - candidate.capturedAt <= maxAgeMs
    )
  const entry = candidates.find((candidate) => candidate.route === currentRoute) || candidates[0]

  if (!entry) {
    return {
      threadIds: [],
      complete: false,
      cacheSize: threadListCache.length,
      error: since
        ? "No intercepted Gmail thread-list response was captured after navigation"
        : "No intercepted Gmail thread-list response is cached",
      recentAttempts: threadListAttempts.slice(-5).reverse(),
      recentGmailResources: getRecentGmailResourcePaths()
    }
  }

  return {
    threadIds: entry.threadIds,
    complete: true,
    source: entry.source,
    route: entry.route,
    capturedAt: entry.capturedAt,
    ageMs: now - entry.capturedAt,
    cacheSize: threadListCache.length
  }
}

function rememberThreadListAttempt(attempt: {
  source: string
  capturedAt: number
  responseLength: number
  threadCount: number
  error?: string
}): void {
  threadListAttempts.push(attempt)
  threadListAttempts.splice(0, Math.max(0, threadListAttempts.length - 10))
}

function extractThreadIdsFromListResponse(url: string, text: string): string[] {
  const parsed = parseGmailJsonPayload(text)
  if (parsed === undefined) return []

  let ids: string[]
  if (isSyncThreadListResponseUrl(url)) {
    ids = extractSyncThreadListIds(parsed)
  } else if (isSyncThreadDataResponseUrl(url)) {
    ids = extractSyncThreadDataIds(parsed)
  } else {
    ids = extractClassicThreadListIds(parsed)
  }

  return [...new Set(ids.filter(isLegacyHexId))]
}

function parseGmailJsonPayload(text: string): unknown {
  const trimmed = text.trim().replace(/^\)\]\}'\s*/, "").trim()
  const direct = safeJsonParse(trimmed)
  if (direct !== undefined) return direct

  const arrayStart = trimmed.indexOf("[")
  if (arrayStart !== -1) {
    const parsed = safeJsonParse(trimmed.slice(arrayStart))
    if (parsed !== undefined) return parsed
  }

  const objectStart = trimmed.indexOf("{")
  if (objectStart !== -1) {
    return safeJsonParse(trimmed.slice(objectStart))
  }

  return undefined
}

function isSyncThreadListResponseUrl(url: string): boolean {
  return /\/sync(?:\/u\/\d+)?\/i\/bv(?:[/?#]|$)/.test(url)
}

function isSyncThreadDataResponseUrl(url: string): boolean {
  return /\/sync(?:\/u\/\d+)?\/i\/fd(?:[/?#]|$)/.test(url)
}

function isUsableThreadListCandidate(url: string, threadIds: string[]): boolean {
  if (threadIds.length === 0) return false
  if (!isSyncThreadDataResponseUrl(url)) return true
  return threadIds.length > 1
}

function extractSyncThreadListIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return [
    ...extractSyncThreadIdsFromDescriptors(value[2], 0, 17, 19),
    ...extractSyncThreadIdsFromDescriptors(value[3], 1, 18, 20)
  ]
}

function extractSyncThreadDataIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return [
    ...extractSyncThreadDataIdsFromDescriptors(value[1], true),
    ...extractSyncThreadDataIdsFromDescriptors(value[2], false)
  ]
}

function extractSyncThreadDataIdsFromDescriptors(
  descriptors: unknown,
  newFormat: boolean
): string[] {
  if (!Array.isArray(descriptors)) return []

  return descriptors.flatMap((wrapper) => {
    if (!Array.isArray(wrapper)) return []

    const directDescriptor = wrapper[newFormat ? 1 : 2]
    if (Array.isArray(directDescriptor)) {
      const id = threadIdFromUnknown(directDescriptor[0]?.[newFormat ? 15 : 16])
      if (id) return [id]
    }

    const nestedDescriptor = wrapper[newFormat ? 1 : 2]?.[newFormat ? 0 : 1]
    if (Array.isArray(nestedDescriptor)) {
      const id = threadIdFromDecimal(nestedDescriptor[newFormat ? 13 : 14]) ||
        threadIdFromUnknown(nestedDescriptor[newFormat ? 13 : 14])
      if (id) return [id]
    }

    return []
  })
}

function extractSyncThreadIdsFromDescriptors(
  descriptors: unknown,
  descriptorIndex: number,
  decimalThreadIdIndex: number,
  fallbackThreadIdIndex: number
): string[] {
  if (!Array.isArray(descriptors)) return []

  return descriptors.flatMap((wrapper) => {
    if (!Array.isArray(wrapper)) return []
    const descriptor = wrapper[descriptorIndex]
    if (!Array.isArray(descriptor)) return []

    const id =
      threadIdFromDecimal(descriptor[decimalThreadIdIndex]) ||
      threadIdFromUnknown(descriptor[fallbackThreadIdIndex])
    return id ? [id] : []
  })
}

function extractClassicThreadListIds(value: unknown): string[] {
  const ids: string[] = []
  visitJson(value, (item) => {
    if (!Array.isArray(item) || item[0] !== "tb" || !Array.isArray(item[2])) return
    item[2].forEach((thread) => {
      if (!Array.isArray(thread)) return
      const id = threadIdFromUnknown(thread[0])
      if (id) ids.push(id)
    })
  })
  return ids
}

function visitJson(value: unknown, visitor: (value: unknown) => void): void {
  visitor(value)
  if (Array.isArray(value)) {
    value.forEach((item) => visitJson(item, visitor))
    return
  }
  if (isPlainObject(value)) {
    Object.values(value).forEach((item) => visitJson(item, visitor))
  }
}

function threadIdFromDecimal(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(Math.trunc(value)).toString(16)
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value).toString(16)
  }
  return ""
}

function threadIdFromUnknown(value: unknown): string {
  const id = stringFromUnknown(value).replace(/^thread-[af]:/i, "")
  if (isLegacyHexId(id)) return id.toLowerCase()
  return threadIdFromDecimal(value)
}

function isLegacyHexId(value: string): boolean {
  return /^[0-9a-f]{16}$/i.test(value)
}

function responseSourceName(url: string): string {
  if (isSyncThreadListResponseUrl(url)) return "gmail sync thread-list"
  if (isSyncThreadDataResponseUrl(url)) return "gmail sync thread-data"
  return "gmail classic thread-list"
}

async function getOmniLabelCatalog(): Promise<OmniLabelCatalogResult> {
  try {
    const idKey = await getGmailIdKey()
    const url = getGmailOmniUrl(idKey)
    const text = await fetchTextWithTimeout(url, 1500, "Gmail view=omni labels request")
    const labelNames = extractOmniLabelNames(text)
    if (labelNames.length === 0) {
      return {
        labels: [],
        complete: false,
        source: redactOmniUrl(url),
        error: `view=omni returned no custom label names (${text.length} chars)`
      }
    }

    return {
      labels: labelNames.map((name) => ({
        id: name,
        name,
        type: "user"
      })),
      complete: true,
      source: redactOmniUrl(url)
    }
  } catch (err) {
    return {
      labels: [],
      complete: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

async function getGmailIdKey(): Promise<string> {
  const fromWindow = getWindowString("GM_ID_KEY")
  if (fromWindow && fromWindow !== "null") return fromWindow

  const accountUrl = `${window.location.origin}/mail/u/${getGmailAccountIndex()}/`
  const html = await fetchTextWithTimeout(accountUrl, 1500, "Gmail bootstrap page request")
  const fromHtml = extractGmailIdKey(html)
  if (fromHtml) return fromHtml

  throw new Error("GM_ID_KEY not found in Gmail page or bootstrap HTML")
}

function getGmailOmniUrl(idKey: string): string {
  const url = new URL(`/mail/u/${getGmailAccountIndex()}/`, window.location.origin)
  url.searchParams.set("ui", "2")
  url.searchParams.set("view", "omni")
  url.searchParams.set("rt", "j")
  url.searchParams.set("ik", idKey)
  return url.href
}

function getGmailAccountIndex(): string {
  return window.location.pathname.match(/\/mail\/u\/(\d+)\//)?.[1] || "0"
}

function getWindowString(key: string): string {
  return stringFromUnknown((window as unknown as Record<string, unknown>)[key])
}

function extractGmailIdKey(text: string): string {
  const patterns = [
    /(?:var\s+)?GM_ID_KEY\s*=\s*['"]([^'"]+)['"]/,
    /["']GM_ID_KEY["']\s*:\s*["']([^"']+)["']/
  ]

  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match?.[1] && match[1] !== "null") return match[1]
  }

  return ""
}

function extractOmniLabelNames(text: string): string[] {
  const startIndex = text.indexOf("[[[")
  if (startIndex === -1) return []

  const payload = safeJsonParse(text.slice(startIndex))
  if (!Array.isArray(payload)) return []

  const root = Array.isArray(payload[0]) ? payload[0] : payload
  const labels = new Set<string>()

  root.forEach((entry) => {
    if (!Array.isArray(entry) || entry[0] !== "omni" || !Array.isArray(entry[1])) return
    entry[1].forEach((item) => {
      if (!Array.isArray(item)) return
      const name = stringFromUnknown(item[0])
      if (looksLikeOmniUserLabelName(name)) labels.add(name)
    })
  })

  return [...labels]
}

function looksLikeOmniUserLabelName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length < 120 &&
    !value.startsWith("^") &&
    !/[<>]/.test(value) &&
    !/^https?:\/\//i.test(value)
  )
}

async function fetchTextWithTimeout(
  url: string,
  timeoutMs: number,
  description = "Gmail request"
): Promise<string> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal
    })
    if (!response.ok) {
      throw new Error(`${description} failed with ${response.status}`)
    }
    return await response.text()
  } finally {
    window.clearTimeout(timeout)
  }
}

function safeJsonParse(value: string): unknown | undefined {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function stringFromUnknown(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function redactOmniUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}?view=${parsed.searchParams.get("view") || "omni"}`
  } catch {
    return url.split("&ik=")[0]
  }
}

function redactPrivateUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url.split("?")[0]
  }
}

function getCachedEmailData(
  gmail: Gmail,
  messageId?: string
): GmailEmailData | undefined {
  const normalizedId = normalizeGmailId(messageId)
  const cached =
    getCachedById(gmail, normalizedId) ||
    (isNewEmailId(normalizedId)
      ? safeCall(() => gmail.new.get.email_data(normalizedId))
      : undefined) ||
    (isNewThreadId(normalizedId)
      ? safeCall(() => gmail.new.get.thread_data(normalizedId))
      : undefined)
  if (cached) return toLegacyEmailData(cached, normalizedId)

  const currentThread = safeCall(() => gmail.new.get.thread_data())
  if (shouldUseCurrentCachedData(currentThread, normalizedId)) {
    return toLegacyEmailData(currentThread, normalizedId)
  }

  const currentEmail = safeCall(() => gmail.new.get.email_data())
  if (shouldUseCurrentCachedData(currentEmail, normalizedId)) {
    return toLegacyEmailData(currentEmail, normalizedId)
  }

  return undefined
}

function getEmailDataDebug(gmail: Gmail, messageId?: string) {
  const normalizedId = normalizeGmailId(messageId)
  const currentEmail = safeCall(() => gmail.new.get.email_data())
  const currentThread = safeCall(() => gmail.new.get.thread_data())

  return {
    requestedId: normalizedId,
    currentPage: safeCall(() => gmail.get.current_page()) || getCurrentPage(),
    threadDetailVisible: hasVisibleThreadDetail(),
    gmailNewEmailId: safeCall(() => gmail.new.get.email_id()),
    gmailNewThreadId: safeCall(() => gmail.new.get.thread_id()),
    domEmailId: getEmailId(),
    domThreadId: getThreadId(),
    currentLegacyIds: Array.from(getCurrentLegacyIds()).slice(0, 8),
    currentLegacyMatchesRequest: normalizedId
      ? isCurrentLegacyThreadRequest(normalizedId)
      : false,
    cacheSizes: {
      emailIdCache: Object.keys(gmail.cache.emailIdCache).length,
      emailLegacyIdCache: Object.keys(gmail.cache.emailLegacyIdCache).length,
      threadCache: Object.keys(gmail.cache.threadCache).length
    },
    cacheMatches: {
      directEmailId: Boolean(normalizedId && gmail.cache.emailIdCache[normalizedId]),
      directLegacyEmailId: Boolean(normalizedId && gmail.cache.emailLegacyIdCache[normalizedId]),
      directThreadId: Boolean(normalizedId && gmail.cache.threadCache[normalizedId]),
      scannedEmailId: Boolean(normalizedId && findCachedEmail(gmail.cache.emailIdCache, normalizedId)),
      scannedLegacyEmailId: Boolean(normalizedId && findCachedEmail(gmail.cache.emailLegacyIdCache, normalizedId)),
      scannedThreadEmail: Boolean(
        normalizedId &&
        Object.values(gmail.cache.threadCache).some((thread) =>
          thread?.emails?.some((email) => matchesEmailId(email, normalizedId))
        )
      )
    },
    currentData: {
      hasCurrentEmailData: Boolean(currentEmail),
      hasCurrentThreadData: Boolean(currentThread),
      currentThreadEmailCount: (currentThread as GmailThreadData | null | undefined)?.emails?.length || 0,
      currentEmailMatchesRequest: Boolean(
        normalizedId && currentEmail && cachedMatchesId(currentEmail, normalizedId)
      ),
      currentThreadMatchesRequest: Boolean(
        normalizedId && currentThread && cachedMatchesId(currentThread, normalizedId)
      )
    },
    xhrWatcherReady: Boolean((gmail as unknown as { tracker?: { xhr_init?: boolean } }).tracker?.xhr_init),
    recentGmailResources: getRecentGmailResourcePaths()
  }
}

function getRecentGmailResourcePaths(): string[] {
  return performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((url) =>
      /mail\.google\.com/.test(url) &&
      (/\/sync\/u\/\d+\/i\/(?:s|fd|bv)(?:[?#]|$)/.test(url) || /[?&]view=/.test(url))
    )
    .slice(-12)
    .map(redactPrivateUrl)
}

function getCachedById(
  gmail: Gmail,
  id?: string
): GmailCachedEmail | GmailThreadData | undefined {
  if (!id) return undefined

  const directEmail =
    gmail.cache.emailIdCache[id] ||
    gmail.cache.emailLegacyIdCache[id]
  if (directEmail) {
    return directEmail.thread_id
      ? gmail.cache.threadCache[directEmail.thread_id] || directEmail
      : directEmail
  }

  const directThread = gmail.cache.threadCache[id]
  if (directThread) return directThread

  return (
    findCachedEmail(gmail.cache.emailIdCache, id) ||
    findCachedEmail(gmail.cache.emailLegacyIdCache, id) ||
    Object.values(gmail.cache.threadCache).find((thread) =>
      thread?.emails?.some((email) => matchesEmailId(email, id))
    )
  )
}

function findCachedEmail(
  cache: Record<string, GmailCachedEmail | undefined>,
  id: string
): GmailCachedEmail | undefined {
  return Object.values(cache).find((email) => matchesEmailId(email, id))
}

function matchesEmailId(email: GmailCachedEmail | undefined, id: string): boolean {
  return email?.id === id || email?.legacy_email_id === id || email?.thread_id === id
}

function shouldUseCurrentCachedData(
  cached: GmailCachedEmail | GmailThreadData | null | undefined,
  id?: string
): boolean {
  return Boolean(
    cached &&
    (!id || cachedMatchesId(cached, id) || isCurrentLegacyThreadRequest(id))
  )
}

function cachedMatchesId(cached: GmailCachedEmail | GmailThreadData, id: string): boolean {
  const threadData = cached as GmailThreadData
  if (threadData.thread_id === id) return true

  const emails = Array.isArray(threadData.emails)
    ? threadData.emails
    : [cached as GmailCachedEmail]
  return emails.some((email) => matchesEmailId(email, id))
}

function isCurrentLegacyThreadRequest(id: string): boolean {
  if (!/^[0-9a-f]{16,}$/i.test(id)) return false
  if (!hasVisibleThreadDetail()) return false
  return getCurrentLegacyIds().has(id)
}

function getCurrentLegacyIds(): Set<string> {
  const ids = new Set<string>()
  if (!hasVisibleThreadDetail()) return ids

  const hash = window.location.hash
  hash.match(/[0-9a-f]{16,}/gi)?.forEach((id) => ids.add(id))

  document
    .querySelectorAll<HTMLElement>(
      "[data-legacy-thread-id], [data-thread-id], [data-legacy-message-id], [data-message-id]"
    )
    .forEach((el) => {
      if (el.closest("tr.zA, [role='row']")) return
      collectLegacyIdsFromElement(el).forEach((id) => ids.add(id))
    })

  return ids
}

function collectLegacyIdsFromElement(el: HTMLElement): string[] {
  const candidates = [
    el.dataset.legacyThreadId,
    el.dataset.threadId,
    el.dataset.legacyMessageId,
    el.dataset.messageId?.replace(/^#/, "")
  ]
  return candidates
    .filter((candidate): candidate is string => Boolean(candidate))
    .filter((candidate) => /^[0-9a-f]{16,}$/i.test(candidate))
}

function normalizeGmailId(id?: string): string | undefined {
  return id?.replace(/^#/, "")
}

function isNewEmailId(id?: string): boolean {
  return /^msg-[af]:/i.test(id || "")
}

function isNewThreadId(id?: string): boolean {
  return /^thread-[af]:/i.test(id || "")
}

function toLegacyEmailData(
  cached: GmailCachedEmail | GmailThreadData | null | undefined,
  requestedId?: string
): GmailEmailData | undefined {
  if (!cached) return undefined

  const threadData = cached as GmailThreadData
  const emails: GmailCachedEmail[] = Array.isArray(threadData.emails)
    ? threadData.emails
    : [cached as GmailCachedEmail]
  if (emails.length === 0) return undefined

  const selected =
    emails.find((email) => email.id === requestedId || email.legacy_email_id === requestedId) ||
    emails[0]
  const threadId = selected.thread_id || threadData.thread_id || requestedId

  return {
    thread_id: threadId,
    first_email: emails[0]?.id || requestedId,
    last_email: emails[emails.length - 1]?.id || requestedId,
    subject: selected.subject || "",
    labels: selected.labels,
    threads: Object.fromEntries(
      emails.map((email) => {
        const id = requestedId && matchesEmailId(email, requestedId)
          ? requestedId
          : email.id || email.legacy_email_id || requestedId || ""

        return [
          id,
          {
            from: formatContact(email.from),
            from_email: email.from?.address,
            to: email.to?.map(formatContact).filter(Boolean),
            cc: email.cc?.map(formatContact).filter(Boolean),
            bcc: email.bcc?.map(formatContact).filter(Boolean),
            subject: email.subject,
            datetime: email.date ? String(email.date) : undefined,
            content_html: email.content_html || undefined,
            labels: email.labels
          }
        ]
      }).filter(([id]) => id)
    )
  }
}

function formatContact(contact?: { name?: string; address?: string } | null): string {
  if (!contact) return ""
  return contact.name
    ? `"${contact.name}" <${contact.address || ""}>`
    : contact.address || ""
}

function isVisible(el: HTMLElement): boolean {
  return Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
}

function safeCall<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch {
    return undefined
  }
}
