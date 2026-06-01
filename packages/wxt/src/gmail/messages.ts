import type { GmailClientError, GmailMessage } from "agent"

import { getVisibleLabelIds, normalizeLabelId } from "./lib/label-model"
import { encodeBase64Url, toGmailMessage } from "./lib/message-format"
import {
  getMainWorldEmailData,
  getMainWorldEmailDebug,
  waitForMainWorldEmailData
} from "./lib/message-sources"
import {
  collectAdditionalThreadPages,
  getCurrentGmailPageRange,
  needsMorePagination,
  resetToFirstResultPage
} from "./lib/pagination"
import { getCurrentInboxSdkSearchQuery } from "./lib/routes"
import {
  appendUniqueThreadIds,
  getEmailDataFromDom,
  getGmailJsVisibleThreadIds,
  getVisibleThreadIdsFromDom,
  getVisibleThreadRows,
  openThreadFromDomFallback
} from "./lib/thread-fallbacks"
import {
  pollThreadListSources,
  waitForMainWorldThreadList
} from "./lib/thread-list-sources"
import type { SourceTrace } from "./lib/types"
import {
  activeThreadIds,
  delay,
  mainWorldBridge,
  messageViewsCache,
  safeCall,
  state,
  unsupported,
  waitForCondition
} from "./state"

export type { SourceTrace, VisibleEmail } from "./lib/types"
export {
  getEmailDataFromDom,
  getVisibleThreadIdsFromDom,
  toMessageRef
} from "./lib/thread-fallbacks"
export {
  encodeBase64Url,
  stripHtml,
  toGmailMessage
} from "./lib/message-format"

export async function listVisibleMessages(
  limit: number,
  query?: string,
  offset = 0
) {
  const gmail = state.gmail
  if (!state.inboxSdk && !mainWorldBridge.call) {
    return unsupported(
      "Gmail interfaces (InboxSDK/MAIN world bridge) are not ready."
    )
  }

  const requestedOffset = Math.max(0, Math.floor(offset || 0))
  const requestedLimit = Math.max(1, Math.floor(limit || 1))
  const targetEndIndex = requestedOffset + requestedLimit
  const listStartedAt = Date.now()
  const sourceTrace: SourceTrace[] = []
  let navigationStep = "none"
  let navigationReason = query
    ? "requested query already active"
    : "no query navigation requested"
  let paginationStep = "none"
  let paginationReason =
    "requested offset/limit range fit within the first collected page"
  const wasThreadDetailPage = await isThreadDetailPage()

  if (query) {
    const currentQuery = getCurrentSearchQuery()

    if (currentQuery !== query || wasThreadDetailPage) {
      console.log(
        `[messages] Navigating to query: "${query}" (current: "${currentQuery}")`
      )
      activeThreadIds.clear()
      if (state.inboxSdk) {
        await state.inboxSdk.Router.goto(
          state.inboxSdk.Router.NativeRouteIDs.SEARCH,
          {
            query
          }
        )
        navigationStep = "inboxsdk search navigation"
      } else {
        window.location.hash = "#search/" + encodeURIComponent(query)
        navigationStep = "hash search navigation"
      }
      navigationReason = wasThreadDetailPage
        ? `messages:list was called on a thread detail page; opened search results for "${query}"`
        : `query changed from "${currentQuery || ""}" to "${query}"`
      sourceTrace.push({
        step: "list route navigation",
        count: 0,
        reason: navigationReason
      })

      await waitForCondition(
        () => {
          const q = getCurrentSearchQuery()
          return q === query ? true : null
        },
        3000,
        100
      )

      await delay(1500)
    }
  } else if (wasThreadDetailPage) {
    console.log(
      "[messages] messages:list called on thread detail page; navigating to inbox list."
    )
    activeThreadIds.clear()
    if (state.inboxSdk) {
      await state.inboxSdk.Router.goto(
        state.inboxSdk.Router.NativeRouteIDs.INBOX
      )
      navigationStep = "inboxsdk inbox navigation"
    } else {
      window.location.hash = "#inbox"
      navigationStep = "hash inbox navigation"
    }
    navigationReason =
      "messages:list was called on a thread detail page without a query; opened Inbox before listing threads"
    sourceTrace.push({
      step: "thread detail guard",
      count: 0,
      reason: navigationReason
    })
    await waitForListRows()
  }

  const firstPageReset = await resetToFirstResultPage(sourceTrace)
  if (firstPageReset.clicked > 0) {
    navigationStep =
      navigationStep === "none"
        ? "gmail first-page reset"
        : `${navigationStep} + gmail first-page reset`
    navigationReason = firstPageReset.reason
  }

  console.log("[messages] Retrieving visible thread IDs...")

  const networkSince = navigationStep === "none" ? undefined : listStartedAt
  const networkList = await waitForMainWorldThreadList(
    networkSince,
    networkSince ? 2500 : 500
  )
  let threadIds = networkList.threadIds
  sourceTrace.push({
    step: "gmail network thread-list cache",
    count: threadIds.length,
    reason: networkList.reason
  })
  let step = threadIds.length > 0 ? "gmail network thread-list cache" : ""
  let reason = threadIds.length > 0 ? networkList.reason : ""

  if (threadIds.length === 0 && gmail) {
    threadIds = getGmailJsVisibleThreadIds(gmail)
    console.log(
      `[messages] Strategy 2 (gmail-js): found ${threadIds.length} threads.`
    )
    sourceTrace.push({
      step: "gmail-js visible_emails",
      count: threadIds.length,
      reason:
        "Gmail network thread-list cache was empty; tried gmail-js visible_emails"
    })
    if (threadIds.length > 0) {
      step = "gmail-js visible_emails"
      reason =
        "gmail-js visible_emails provided ids after network cache was empty"
    }
  }

  if (threadIds.length === 0) {
    threadIds = Array.from(activeThreadIds)
    console.log(
      `[messages] Strategy 3 (InboxSDK tracked): found ${threadIds.length} threads.`
    )
    sourceTrace.push({
      step: "inboxsdk tracked threads",
      count: threadIds.length,
      reason: state.inboxSdk
        ? "Gmail network and gmail-js visible caches were empty; InboxSDK thread row handler tracks visible rows"
        : "InboxSDK unavailable"
    })
    if (threadIds.length > 0) {
      step = "inboxsdk tracked threads"
      reason =
        "InboxSDK provided visible thread row ids after network caches were empty"
    }
  }

  if (threadIds.length === 0) {
    threadIds = getVisibleThreadIdsFromDom()
    console.log(
      `[messages] Strategy 4 (DOM Scraper): found ${threadIds.length} threads.`
    )
    sourceTrace.push({
      step: "dom visible rows",
      count: threadIds.length,
      reason:
        "Network, gmail-js, and InboxSDK row discovery were empty; scraped visible Gmail rows"
    })
    if (threadIds.length > 0) {
      step = "dom visible rows"
      reason = "Earlier strategies were empty; DOM row scrape found ids"
    }
  }

  if (threadIds.length === 0 && query) {
    console.log(
      "[messages] Thread list is initially empty. Polling for DOM update..."
    )
    const polledIds = await pollThreadListSources(networkSince, 2000, 200)

    if (polledIds && polledIds.length > 0) {
      threadIds = polledIds
      console.log(
        `[messages] Polled successfully: found ${threadIds.length} threads.`
      )
      sourceTrace.push({
        step: "polled visible rows",
        count: threadIds.length,
        reason:
          "Initial query result list was empty; polling found network cache or rendered rows"
      })
      step = "polled visible rows"
      reason =
        "Initial query result list was empty; polling found network cache or rendered rows"
    }
  }

  if (threadIds.length < targetEndIndex) {
    const supplement = supplementCurrentVisiblePage(threadIds, gmail)
    if (supplement.added > 0) {
      sourceTrace.push({
        step: "current visible page supplement",
        count: supplement.added,
        reason: supplement.reason
      })
    }
  }

  if (
    needsMorePagination(
      threadIds.length,
      targetEndIndex,
      getCurrentGmailPageRange()
    )
  ) {
    const pagination = await collectAdditionalThreadPages(
      threadIds,
      targetEndIndex,
      requestedOffset,
      requestedLimit,
      sourceTrace
    )
    paginationStep = pagination.step
    paginationReason = pagination.reason
    if (pagination.networkAdded > 0) {
      step = "gmail network thread-list pagination"
      reason = `Collected ${threadIds.length} ids across ${pagination.pagesVisited} additional Gmail page(s), using intercepted network responses where available`
    } else if (!step && pagination.fallbackAdded > 0) {
      step = "paginated visible rows"
      reason = `Collected ${threadIds.length} ids across ${pagination.pagesVisited} additional Gmail page(s) using visible row fallback`
    }
  }

  const messages = threadIds.map((id) => ({ id, threadId: id }))

  return {
    messages: messages.slice(requestedOffset, targetEndIndex),
    resultSizeEstimate: messages.length,
    offset: requestedOffset,
    limit: requestedLimit,
    step: step || "no visible messages",
    reason: reason || "No strategy found visible message ids",
    navigationStep,
    navigationReason,
    paginationStep,
    paginationReason,
    sourceTrace
  }
}

export async function getMessage(
  messageId: string,
  metadataOnly: boolean
): Promise<GmailMessage | GmailClientError> {
  const directData = await getMainWorldEmailData(messageId)
  if (directData) {
    return {
      ...toGmailMessage(messageId, directData, metadataOnly),
      step: "gmail-js cache",
      reason:
        "MAIN world gmail-js cache already had thread data before navigation"
    } as any
  }

  let cached = messageViewsCache.get(messageId)
  let cachedStep = cached ? "inboxsdk cache" : ""
  if (!cached) {
    cached = getEmailDataFromDom(messageId) ?? undefined
    if (cached) cachedStep = "dom scrape"
  }

  if (!cached) {
    if (state.inboxSdk) {
      try {
        state.inboxSdk.Router.goto(
          state.inboxSdk.Router.NativeRouteIDs.THREAD,
          {
            threadID: messageId
          }
        )
      } catch {}
    } else {
      openThreadFromDomFallback(messageId)
    }

    cached =
      (await waitForCondition(
        () => {
          return messageViewsCache.get(messageId) || null
        },
        5000,
        200
      )) ?? undefined
    if (cached) cachedStep = "inboxsdk cache after navigation"
  }

  const rawData = await waitForMainWorldEmailData(messageId)
  if (rawData) {
    return {
      ...toGmailMessage(messageId, rawData, metadataOnly),
      step: "gmail-js network",
      reason: "After navigation, MAIN world gmail-js exposed raw thread data"
    } as any
  }

  const gmailJsDebug = await getMainWorldEmailDebug(messageId)
  if (cached) {
    const rawLabels = cached.labels || getVisibleLabelIds(messageId) || []
    const labelIds = rawLabels.map(normalizeLabelId)

    return {
      id: cached.id,
      threadId: cached.threadId,
      labelIds,
      snippet: cached.body.slice(0, 160),
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: cached.from },
          { name: "To", value: cached.to },
          { name: "Subject", value: cached.subject },
          { name: "Date", value: cached.date }
        ].filter((header) => header.value),
        body: metadataOnly ? undefined : { data: encodeBase64Url(cached.body) }
      },
      step: cachedStep || "dom fallback",
      reason: fallbackReason(cachedStep),
      gmailJsDebug
    } as any
  }

  return {
    error: `No message data is available for ${messageId} even after UI navigation.`,
    gmailJsDebug
  } as any
}

function supplementCurrentVisiblePage(
  threadIds: string[],
  gmail: typeof state.gmail
): { added: number; reason: string } {
  let totalAdded = 0
  const reasons: string[] = []

  const gmailJsIds = getGmailJsVisibleThreadIds(gmail)
  const gmailJsAdded = appendUniqueThreadIds(threadIds, gmailJsIds)
  if (gmailJsAdded > 0) {
    totalAdded += gmailJsAdded
    reasons.push(`gmail-js visible_emails added ${gmailJsAdded}`)
  }

  const trackedAdded = appendUniqueThreadIds(
    threadIds,
    Array.from(activeThreadIds)
  )
  if (trackedAdded > 0) {
    totalAdded += trackedAdded
    reasons.push(`InboxSDK tracked rows added ${trackedAdded}`)
  }

  const domAdded = appendUniqueThreadIds(
    threadIds,
    getVisibleThreadIdsFromDom()
  )
  if (domAdded > 0) {
    totalAdded += domAdded
    reasons.push(`DOM visible rows added ${domAdded}`)
  }

  return {
    added: totalAdded,
    reason:
      reasons.length > 0
        ? `Network cache had fewer ids than requested; supplemented current page (${reasons.join(", ")})`
        : "Network cache had fewer ids than requested; current visible page sources added no new ids"
  }
}

async function isThreadDetailPage(): Promise<boolean> {
  const routeType = safeCall(() => {
    const router = state.inboxSdk?.Router as any
    return router?.getCurrentRouteView?.()?.getRouteType?.()
  })
  const threadRouteType = safeCall(() => {
    const router = state.inboxSdk?.Router as any
    return router?.RouteTypes?.THREAD
  })
  if (routeType && threadRouteType) return routeType === threadRouteType

  const snapshot = mainWorldBridge.call
    ? await mainWorldBridge.call("snapshot").catch(() => undefined)
    : undefined
  if (snapshot?.page === "email") return true

  return (
    isThreadHash(window.location.hash) ||
    (Boolean(document.querySelector("h2.hP, div.adn")) &&
      getVisibleThreadRows().length === 0)
  )
}

function isThreadHash(hash: string): boolean {
  return /#(?:inbox|all|sent|starred|trash|spam|imp|search|label\/[^/]+)\/[0-9a-fA-F]{16}(?:[/?]|$)/.test(
    hash
  )
}

async function waitForListRows(): Promise<string[]> {
  const ids = await waitForCondition(
    () => {
      const tracked = Array.from(activeThreadIds)
      if (tracked.length > 0) return tracked

      const scraped = getVisibleThreadIdsFromDom()
      return scraped.length > 0 ? scraped : null
    },
    4000,
    200
  )

  return ids ?? []
}

function fallbackReason(step: string): string {
  if (step === "inboxsdk cache") {
    return "gmail-js cache was unavailable; reused InboxSDK message view cache"
  }
  if (step === "inboxsdk cache after navigation") {
    return "gmail-js raw data did not become available after navigation; used InboxSDK message view cache"
  }
  if (step === "dom scrape") {
    return "gmail-js and InboxSDK cache were unavailable; scraped the active Gmail DOM"
  }
  return "gmail-js raw data was unavailable; used final fallback"
}

function getCurrentSearchQuery(): string {
  const routeQuery = getCurrentInboxSdkSearchQuery()
  if (routeQuery !== undefined) return routeQuery

  const gmailQuery = safeCall(() => {
    const gmail = state.gmail
    return gmail ? (gmail.get as any).search_query() : undefined
  })
  if (gmailQuery !== undefined) return gmailQuery

  const searchInput = document.querySelector<HTMLInputElement>(
    'form[role="search"] input[name="q"]'
  )
  return searchInput?.value || ""
}
