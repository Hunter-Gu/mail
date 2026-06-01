import {
  activeThreadIds,
  delay
} from "../state"
import {
  appendUniqueThreadIds,
  collectVisiblePageThreadIds,
  waitForNewVisiblePageIds
} from "./thread-fallbacks"
import { clickGmailButton, isVisible } from "./dom"
import {
  buildInboxSdkPageParams,
  formatInboxSdkPageLabel,
  getCurrentInboxSdkListPageNumber,
  getInboxSdkListRouteContext
} from "./routes"
import { waitForMainWorldThreadList } from "./thread-list-sources"
import type {
  GmailPageRange,
  GmailPaginationDirection,
  SourceTrace
} from "./types"

export async function resetToFirstResultPage(
  sourceTrace: SourceTrace[]
): Promise<{ clicked: number; reason: string }> {
  let range = getCurrentGmailPageRange()
  if (!range) {
    const currentRoutePageNumber = getCurrentInboxSdkListPageNumber()
    if (currentRoutePageNumber > 1) {
      const routeReset = await navigateToInboxSdkListPage(1, null, "newer")
      sourceTrace.push({
        step: "inboxsdk route page navigation",
        count: routeReset.attempted ? 1 : 0,
        reason: routeReset.reason
      })
      return {
        clicked: routeReset.attempted ? 1 : 0,
        reason: routeReset.reason
      }
    }

    sourceTrace.push({
      step: "gmail first-page reset",
      count: 0,
      reason: "Could not detect Gmail range before listing; assuming current page is the first result page"
    })
    return {
      clicked: 0,
      reason: "Gmail range was unavailable before listing"
    }
  }

  if (range.start <= 1) {
    sourceTrace.push({
      step: "gmail first-page reset",
      count: 0,
      reason: `Gmail range "${range.raw}" is already on the first result page`
    })
    return {
      clicked: 0,
      reason: `Gmail range "${range.raw}" is already on the first result page`
    }
  }

  let clicked = 0
  const maxClicks = Math.ceil((range.start - 1) / Math.max(1, range.pageSize)) + 2

  const routeReset = await navigateToInboxSdkListPage(1, range, "newer")
  if (routeReset.attempted) {
    sourceTrace.push({
      step: "inboxsdk route page navigation",
      count: 1,
      reason: routeReset.reason
    })
    if (routeReset.advancedRange) {
      clicked++
      range = routeReset.advancedRange
      sourceTrace.push({
        step: "gmail pagination range",
        count: routeReset.advancedRange.end,
        reason: `Gmail visible range advanced to "${routeReset.advancedRange.raw}"`
      })
    } else {
      range = getCurrentGmailPageRange() || range
    }
  }

  while (range.start > 1 && clicked < maxClicks) {
    const newerButton = findNewerPageButton()
    if (!newerButton) {
      const reason = `Gmail range "${range.raw}" is not on the first page, but no enabled Newer/previous-page button was found`
      sourceTrace.push({
        step: "gmail first-page reset",
        count: clicked,
        reason
      })
      return { clicked, reason }
    }

    const previousRange = range
    activeThreadIds.clear()
    clickGmailButton(newerButton)
    clicked++

    const advancedRange = await waitForGmailPageRangeAdvance(previousRange, "newer", 5000, 200)
    range = advancedRange || getCurrentGmailPageRange() || range
    sourceTrace.push({
      step: "gmail newer page click",
      count: clicked,
      reason: advancedRange
        ? `Clicked Gmail Newer/previous-page button; range advanced from "${previousRange.raw}" to "${advancedRange.raw}"`
        : `Clicked Gmail Newer/previous-page button, but range did not visibly advance from "${previousRange.raw}"`
    })

    if (!advancedRange) break
  }

  const reason = range.start <= 1
    ? `Reset Gmail list to the first result page at range "${range.raw}" before applying offset`
    : `Stopped first-page reset at range "${range.raw}" after ${clicked} first-page navigation attempt(s)`
  sourceTrace.push({
    step: "gmail first-page reset",
    count: clicked,
    reason
  })
  return { clicked, reason }
}

export async function collectAdditionalThreadPages(
  threadIds: string[],
  targetEndIndex: number,
  requestedOffset: number,
  requestedLimit: number,
  sourceTrace: SourceTrace[]
): Promise<{
  step: string
  reason: string
  pagesVisited: number
  networkAdded: number
  fallbackAdded: number
}> {
  let pagesVisited = 0
  let networkAdded = 0
  let fallbackAdded = 0
  let stopReason = "requested offset/limit range already satisfied"
  let currentRange = getCurrentGmailPageRange()
  const maxTurns = getPaginationTurnBudget(targetEndIndex, threadIds.length, currentRange)

  sourceTrace.push({
    step: "gmail pagination plan",
    count: maxTurns,
    reason: formatPaginationPlanReason(
      currentRange,
      targetEndIndex,
      requestedOffset,
      requestedLimit,
      threadIds.length,
      maxTurns
    )
  })

  for (
    let turn = 0;
    needsMorePagination(threadIds.length, targetEndIndex, currentRange) && turn < maxTurns;
    turn++
  ) {
    const previousRange = currentRange
    let pageCollected = false
    const routePageNumber = previousRange
      ? getPageNumberFromRange(previousRange) + 1
      : getCurrentInboxSdkListPageNumber() + 1

    const routeNavigation = await navigateToInboxSdkListPage(routePageNumber, previousRange, "older")
    if (routeNavigation.attempted) {
      sourceTrace.push({
        step: "inboxsdk route page navigation",
        count: routePageNumber,
        reason: routeNavigation.reason
      })
      currentRange = routeNavigation.advancedRange || getCurrentGmailPageRange() || currentRange
      if (routeNavigation.advancedRange) {
        sourceTrace.push({
          step: "gmail pagination range",
          count: routeNavigation.advancedRange.end,
          reason: `Gmail visible range advanced to "${routeNavigation.advancedRange.raw}"`
        })
      }

      const collected = await collectThreadIdsAfterPageNavigation(
        threadIds,
        targetEndIndex,
        routeNavigation.startedAt,
        sourceTrace
      )
      networkAdded += collected.networkAdded
      fallbackAdded += collected.fallbackAdded
      pageCollected = Boolean(
        routeNavigation.advancedRange ||
        collected.networkAdded > 0 ||
        collected.fallbackAdded > 0
      )
      if (pageCollected) {
        pagesVisited++
        continue
      }
    }

    const olderButton = findOlderPageButton()
    if (!olderButton) {
      stopReason = previousRange
        ? "InboxSDK route page navigation did not produce a new page, and no enabled Gmail Older/next-page button was found"
        : "no enabled Gmail Older/next-page button was found"
      break
    }

    const pageStartedAt = Date.now()
    activeThreadIds.clear()
    clickGmailButton(olderButton)
    sourceTrace.push({
      step: "gmail older page click",
      count: threadIds.length,
      reason: `Clicked Gmail Older/next-page button internally to collect offset ${requestedOffset}, limit ${requestedLimit}`
    })

    const advancedRange = previousRange
      ? await waitForGmailPageRangeAdvance(previousRange, "older", 5000, 200)
      : null
    currentRange = advancedRange || getCurrentGmailPageRange() || currentRange
    if (advancedRange) {
      sourceTrace.push({
        step: "gmail pagination range",
        count: advancedRange.end,
        reason: `Gmail visible range advanced to "${advancedRange.raw}"`
      })
    }

    const collected = await collectThreadIdsAfterPageNavigation(
      threadIds,
      targetEndIndex,
      pageStartedAt,
      sourceTrace
    )
    networkAdded += collected.networkAdded
    fallbackAdded += collected.fallbackAdded

    if (advancedRange || collected.networkAdded > 0 || collected.fallbackAdded > 0) {
      pagesVisited++
      continue
    }

    stopReason = `attempted Gmail pagination but no new ids arrived (${collected.networkReason})`
    break
  }

  if (!needsMorePagination(threadIds.length, targetEndIndex, currentRange)) {
    stopReason = `collected requested offset ${requestedOffset}, limit ${requestedLimit}`
  } else if (maxTurns === 0 && currentRange?.total && currentRange.end >= currentRange.total) {
    stopReason = `Gmail range "${currentRange.raw}" indicates this is the final page`
  } else if (pagesVisited >= maxTurns) {
    stopReason = `stopped after ${maxTurns} pagination attempts with ${threadIds.length}/${targetEndIndex} ids`
  }

  return {
    step: pagesVisited > 0 ? "gmail older pagination" : "none",
    reason: pagesVisited > 0
      ? `${stopReason}; network added ${networkAdded}, fallback added ${fallbackAdded}`
      : stopReason,
    pagesVisited,
    networkAdded,
    fallbackAdded
  }
}

export function needsMorePagination(
  collectedCount: number,
  targetEndIndex: number,
  range: GmailPageRange | null
): boolean {
  if (range?.total && range.end >= range.total) return false
  if (collectedCount < targetEndIndex) return true
  return Boolean(range && range.end < targetEndIndex)
}

export function getCurrentGmailPageRange(): GmailPageRange | null {
  const candidates = collectPaginationTextCandidates()
  for (const text of candidates) {
    const parsed = parseGmailPageRange(text)
    if (parsed) return parsed
  }
  return null
}

async function collectThreadIdsAfterPageNavigation(
  threadIds: string[],
  targetEndIndex: number,
  pageStartedAt: number,
  sourceTrace: SourceTrace[]
): Promise<{ networkAdded: number; fallbackAdded: number; networkReason: string }> {
  const network = await waitForMainWorldThreadList(pageStartedAt, 5000, 200)
  const addedFromNetwork = appendUniqueThreadIds(threadIds, network.threadIds)
  if (addedFromNetwork > 0) {
    sourceTrace.push({
      step: "gmail network thread-list page",
      count: addedFromNetwork,
      reason: network.reason
    })
  }

  const fallbackIds = threadIds.length < targetEndIndex || addedFromNetwork === 0
    ? await waitForNewVisiblePageIds(threadIds, 3500, 200)
    : null
  const addedFromFallback = appendUniqueThreadIds(threadIds, fallbackIds || [])
  if (addedFromFallback > 0) {
    sourceTrace.push({
      step: "paginated visible rows",
      count: addedFromFallback,
      reason: `Interception did not fully cover the requested page window after Gmail pagination; visible rows supplied ${addedFromFallback} new ids`
    })
  }

  return {
    networkAdded: addedFromNetwork,
    fallbackAdded: addedFromFallback,
    networkReason: network.reason
  }
}

async function navigateToInboxSdkListPage(
  pageNumber: number,
  previousRange: GmailPageRange | null,
  direction: GmailPaginationDirection
): Promise<{
  attempted: boolean
  startedAt: number
  advancedRange: GmailPageRange | null
  reason: string
}> {
  const startedAt = Date.now()
  const context = getInboxSdkListRouteContext()
  if (!context.ok) {
    return {
      attempted: false,
      startedAt,
      advancedRange: null,
      reason: context.reason
    }
  }

  const params = buildInboxSdkPageParams(context.params, pageNumber)
  activeThreadIds.clear()

  try {
    await context.router.goto(
      context.routeId,
      Object.keys(params).length > 0 ? params : undefined
    )
  } catch (err) {
    return {
      attempted: false,
      startedAt,
      advancedRange: null,
      reason: `InboxSDK Router.goto failed for Gmail list page ${formatInboxSdkPageLabel(pageNumber)}: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  const advancedRange = previousRange
    ? await waitForGmailPageRangeAdvance(previousRange, direction, 5000, 200)
    : null
  return {
    attempted: true,
    startedAt,
    advancedRange,
    reason: advancedRange && previousRange
      ? `InboxSDK Router.goto opened Gmail list page ${formatInboxSdkPageLabel(pageNumber)} from range "${previousRange.raw}" to "${advancedRange.raw}"`
      : previousRange
        ? `InboxSDK Router.goto requested Gmail list page ${formatInboxSdkPageLabel(pageNumber)}, but the visible range did not advance from "${previousRange.raw}"`
        : `InboxSDK Router.goto requested Gmail list page ${formatInboxSdkPageLabel(pageNumber)}; Gmail range text was unavailable, so completion will be judged by network or visible ids`
  }
}

function getPageNumberFromRange(range: GmailPageRange): number {
  return Math.max(1, Math.ceil(range.start / Math.max(1, range.pageSize)))
}

function getPaginationTurnBudget(
  targetEndIndex: number,
  collectedCount: number,
  range: GmailPageRange | null
): number {
  const remainingByCount = targetEndIndex - collectedCount
  const remainingByRange = range && !(range.total && range.end >= range.total)
    ? targetEndIndex - range.end
    : 0
  const remaining = Math.max(remainingByCount, remainingByRange)
  if (remaining <= 0) return 0
  if (range?.total && range.end >= range.total) return 0

  const visiblePageSize = collectVisiblePageThreadIds().length
  const pageSize = Math.max(1, range?.pageSize || visiblePageSize || collectedCount || 40)
  const availableAfterCurrent = range?.total
    ? Math.max(0, range.total - range.end)
    : undefined
  const collectible = availableAfterCurrent === undefined
    ? remaining
    : Math.min(remaining, availableAfterCurrent)
  if (collectible <= 0) return 0

  const plannedTurns = Math.ceil(collectible / pageSize)
  return range ? plannedTurns : plannedTurns + 2
}

function formatPaginationPlanReason(
  range: GmailPageRange | null,
  targetEndIndex: number,
  requestedOffset: number,
  requestedLimit: number,
  collectedCount: number,
  maxTurns: number
): string {
  const rangeText = `offset ${requestedOffset}, limit ${requestedLimit} (need first ${targetEndIndex} result ids)`
  if (range) {
    const total = range.total ? `total ${range.total}` : "unknown total"
    return `Detected Gmail range "${range.raw}" (page size ${range.pageSize}, ${total}); ${rangeText}; collected ${collectedCount}/${targetEndIndex}; planned up to ${maxTurns} internal page navigation(s)`
  }

  return `Could not detect Gmail range/page size; ${rangeText}; collected ${collectedCount}/${targetEndIndex}; planned up to ${maxTurns} conservative internal page navigation(s)`
}

async function waitForGmailPageRangeAdvance(
  previousRange: GmailPageRange,
  direction: GmailPaginationDirection,
  timeoutMs: number,
  intervalMs: number
): Promise<GmailPageRange | null> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const currentRange = getCurrentGmailPageRange()
    if (
      currentRange &&
      isExpectedRangeAdvance(previousRange, currentRange, direction)
    ) {
      return currentRange
    }
    await delay(intervalMs)
  }
  return null
}

function isExpectedRangeAdvance(
  previousRange: GmailPageRange,
  currentRange: GmailPageRange,
  direction: GmailPaginationDirection
): boolean {
  if (direction === "older") {
    return currentRange.start > previousRange.start || currentRange.end > previousRange.end
  }
  return currentRange.start < previousRange.start || currentRange.end < previousRange.end
}

function collectPaginationTextCandidates(): string[] {
  const values = new Set<string>()
  const add = (value: string | null | undefined) => {
    const text = value?.replace(/\s+/g, " ").trim()
    if (text) values.add(text)
  }

  const selectors = [
    ".Dj",
    ".Di .Dj",
    '[role="navigation"] .Dj',
    '[aria-label*=" of "]',
    '[aria-label*="Showing"]',
    '[aria-label*="共"]',
    '[title*=" of "]',
    '[title*="共"]'
  ]

  for (const el of Array.from(document.querySelectorAll<HTMLElement>(selectors.join(", ")))) {
    if (!isVisible(el)) continue
    add(el.innerText)
    add(el.textContent)
    add(el.getAttribute("aria-label"))
    add(el.getAttribute("title"))
  }

  return Array.from(values)
}

function parseGmailPageRange(text: string): GmailPageRange | null {
  const normalized = text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()
  const match = normalized.match(
    /([\d,]+)\s*(?:[-–—]|至|到)\s*([\d,]+)\s*(?:封邮件|邮件|封|条|项|个)?\s*(?:,|，|\s)*(?:of|共|总共|总计)\s*(many|很多|[\d,]+)/i
  )
  if (!match) return null

  const start = parseIntegerText(match[1])
  const end = parseIntegerText(match[2])
  const total = parseIntegerText(match[3])
  if (!start || !end || end < start) return null

  const pageSize = end - start + 1
  if (pageSize <= 0 || pageSize > 500) return null

  return {
    raw: normalized,
    start,
    end,
    pageSize,
    total
  }
}

function parseIntegerText(value: string): number | undefined {
  if (/^(many|很多)$/i.test(value.trim())) return undefined
  const parsed = Number(value.replace(/[^\d]/g, ""))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function findOlderPageButton(): HTMLElement | null {
  const selectors = [
    '[aria-label*="Older"]',
    '[data-tooltip*="Older"]',
    '[title*="Older"]',
    '[aria-label*="older"]',
    '[data-tooltip*="older"]',
    '[aria-label*="Next page"]',
    '[data-tooltip*="Next page"]',
    '[title*="Next page"]',
    '[aria-label*="下一页"]',
    '[data-tooltip*="下一页"]',
    '[title*="下一页"]',
    '[aria-label*="较旧"]',
    '[data-tooltip*="较旧"]',
    '[title*="较旧"]'
  ]

  for (const selector of selectors) {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
    const button = candidates.find((candidate) =>
      isEnabledGmailButton(candidate) && isOlderPaginationButton(candidate)
    )
    if (button) return button
  }

  return null
}

function findNewerPageButton(): HTMLElement | null {
  const selectors = [
    '[aria-label*="Newer"]',
    '[data-tooltip*="Newer"]',
    '[title*="Newer"]',
    '[aria-label*="newer"]',
    '[data-tooltip*="newer"]',
    '[aria-label*="Previous page"]',
    '[data-tooltip*="Previous page"]',
    '[title*="Previous page"]',
    '[aria-label*="上一页"]',
    '[data-tooltip*="上一页"]',
    '[title*="上一页"]',
    '[aria-label*="较新"]',
    '[data-tooltip*="较新"]',
    '[title*="较新"]'
  ]

  for (const selector of selectors) {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
    const button = candidates.find((candidate) =>
      isEnabledGmailButton(candidate) && isNewerPaginationButton(candidate)
    )
    if (button) return button
  }

  return null
}

function isOlderPaginationButton(el: HTMLElement): boolean {
  const label = paginationButtonLabel(el)
  return (
    hasPaginationKeyword(label, ["older", "next page", "下一页", "较旧"]) &&
    !hasPaginationKeyword(label, ["newer", "previous page", "上一页", "较新"])
  )
}

function isNewerPaginationButton(el: HTMLElement): boolean {
  const label = paginationButtonLabel(el)
  return (
    hasPaginationKeyword(label, ["newer", "previous page", "上一页", "较新"]) &&
    !hasPaginationKeyword(label, ["older", "next page", "下一页", "较旧"])
  )
}

function paginationButtonLabel(el: HTMLElement): string {
  return [
    el.getAttribute("aria-label"),
    el.getAttribute("data-tooltip"),
    el.getAttribute("title"),
    el.textContent
  ].filter(Boolean).join(" ").toLowerCase()
}

function hasPaginationKeyword(label: string, keywords: string[]): boolean {
  return keywords.some((keyword) => label.includes(keyword.toLowerCase()))
}

function isEnabledGmailButton(el: HTMLElement): boolean {
  return (
    isVisible(el) &&
    el.getAttribute("aria-disabled") !== "true" &&
    el.getAttribute("disabled") == null &&
    !el.classList.contains("T-I-JE")
  )
}
