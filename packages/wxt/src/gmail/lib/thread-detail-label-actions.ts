import type {
  GmailClientError,
  GmailMessage
} from "agent"

import {
  delay,
  mainWorldBridge,
  state,
  unsupported
} from "../state"
import { clickGmailButton, isVisible, safeClick } from "./dom"
import {
  getVisibleLabelIds,
  normalizeLabelId,
  systemLabelIds,
  systemLabels
} from "./label-model"
import { getMainWorldEmailData, getMainWorldEmailDebug, waitForMainWorldEmailData } from "./message-sources"
import { toGmailMessage } from "./message-format"
import { showGmailAgentNotice } from "./notification"
import { openThreadFromDomFallback } from "./thread-fallbacks"

export type ThreadDetailLabelUpdateNavigation = {
  step: string
  confirmed: boolean
  reason: string
}

export type ThreadDetailLabelActionReport = {
  success: boolean
  clicked: string[]
  missing: string[]
  matchedCustomLabels: string[]
  unmatchedCustomRemoves: string[]
  menuItemCount: number
  visibleActionCandidates: string[]
  logs: string[]
}

const MARK_READ_KEYWORDS = ["mark as read", "mark read", "标记为已读"]
const MARK_UNREAD_KEYWORDS = ["mark as unread", "mark unread", "标记为未读"]

export async function updateLabelsFromThreadDetail(
  messageId: string,
  addLabelIds: string[] = [],
  removeLabelIds: string[] = []
): Promise<GmailMessage | GmailClientError> {
  const logs: string[] = []
  const log = (msg: string) => {
    const formatted = `[thread-detail-labels:update] ${msg}`
    console.log(formatted)
    logs.push(formatted)
  }

  if (!state.inboxSdk && !mainWorldBridge.call) {
    return unsupported("Gmail interfaces (InboxSDK/MAIN world bridge) are not ready.")
  }

  log(`updateLabelsFromThreadDetail called for ${messageId}; add=${JSON.stringify(addLabelIds)}, remove=${JSON.stringify(removeLabelIds)}`)
  let data = await getMainWorldEmailData(messageId)
  log(data ? "Initial gmail-js message data is available." : "Initial gmail-js message data is unavailable.")

  const navigation = await ensureThreadOpenForDetailLabelUpdate(messageId, log)
  if (!navigation.confirmed) {
    return {
      error: `Cannot confirm Gmail opened target thread ${messageId} before updating labels.`,
      logs,
      navigation
    } as any
  }

  data = await waitForMainWorldEmailData(messageId, 5000, 200) || data
  if (!data) {
    return {
      error: `Cannot load email ${messageId} data after opening target thread.`,
      logs,
      navigation
    } as any
  }

  const normalizedAdds = normalizeRequestedLabelIds(addLabelIds)
  const normalizedRemoves = normalizeRequestedLabelIds(removeLabelIds)
  log(`Normalized label changes; add=${JSON.stringify(normalizedAdds)}, remove=${JSON.stringify(normalizedRemoves)}`)

  const completeExistingLabels = getCompleteExistingLabelIds(data, messageId)
  const routeLabelHints = completeExistingLabels.length === 0
    ? getCurrentThreadRouteLabelHints()
    : []
  const existingLabels = completeExistingLabels.length > 0
    ? completeExistingLabels
    : routeLabelHints
  const hasCompleteExistingLabelData = completeExistingLabels.length > 0
  const effectiveAdds = hasCompleteExistingLabelData
    ? normalizedAdds.filter((label) => !existingLabels.includes(label))
    : normalizedAdds.filter((label) => !routeLabelHints.includes(label))
  const effectiveRemoves = hasCompleteExistingLabelData
    ? normalizedRemoves.filter((label) => existingLabels.includes(label))
    : normalizedRemoves
  const actionAdds = effectiveAdds.filter(isSupportedDetailAddLabel)
  const actionRemoves = effectiveRemoves.filter(isSupportedDetailRemoveLabel)
  const unsupportedAdds = effectiveAdds.filter((label) => !isSupportedDetailAddLabel(label))
  const unsupportedRemoves = effectiveRemoves.filter((label) => !isSupportedDetailRemoveLabel(label))

  if (hasCompleteExistingLabelData) {
    log(`Existing labels before update: ${JSON.stringify(existingLabels)}; effective add=${JSON.stringify(effectiveAdds)}, effective remove=${JSON.stringify(effectiveRemoves)}`)
  } else if (routeLabelHints.length > 0) {
    log(`Complete existing labels were unavailable; using current Gmail route label hints ${JSON.stringify(routeLabelHints)} for add no-op filtering; effective add=${JSON.stringify(effectiveAdds)}, effective remove=${JSON.stringify(effectiveRemoves)}`)
  } else {
    log("Existing labels were unavailable; applying requested label changes without no-op filtering.")
  }

  if (unsupportedAdds.length > 0 || unsupportedRemoves.length > 0) {
    log(`Unsupported thread-detail label changes detected; unsupported add=${JSON.stringify(unsupportedAdds)}, unsupported remove=${JSON.stringify(unsupportedRemoves)}; supported add=${JSON.stringify(actionAdds)}, supported remove=${JSON.stringify(actionRemoves)}`)
    return unsupportedThreadDetailLabelChangeResponse(
      messageId,
      unsupportedAdds,
      unsupportedRemoves,
      logs,
      navigation
    )
  }

  if (actionAdds.length === 0 && actionRemoves.length === 0) {
    log("No Gmail detail-page label UI action was needed after no-op filtering.")
    const updatedMessage = toGmailMessage(messageId, data, false)
    updatedMessage.labelIds = buildExpectedLabelIds(existingLabels, normalizedAdds, normalizedRemoves)
    return {
      ...updatedMessage,
      step: "gmail thread detail label update",
      reason: `Opened target thread and skipped Gmail detail-page label UI actions because requested labels were already satisfied (${updatedMessage.labelIds.join(", ")})`,
      logs,
      navigation,
      labelActionTrace: emptyThreadDetailLabelActionTrace()
    } as any
  }

  const actionReport = await applyThreadDetailLabelDomActions(actionAdds, actionRemoves)
  logs.push(...actionReport.logs)
  if (!actionReport.success) {
    const reason = `Gmail detail-page UI could not complete supported label changes: ${actionReport.missing.join("; ") || "unknown failure"}`
    showGmailAgentNotice(
      "Mail Agent could not update Gmail labels from the open thread",
      `${reason}. This request will not be retried automatically.`
    )
    return {
      error: `Gmail detail-page label UI action did not complete for ${messageId}: ${actionReport.missing.join("; ") || "unknown failure"}. A notice was shown to the user; do not retry this request in WXT.`,
      nonRetryable: true,
      userNotified: true,
      step: "gmail thread detail label update failed",
      reason,
      logs,
      navigation,
      labelActionTrace: actionReport
    } as any
  }

  const updatedData = await getMainWorldEmailData(messageId) || data
  const updatedMessage = toGmailMessage(messageId, updatedData, false)
  updatedMessage.labelIds = buildExpectedLabelIds(existingLabels, normalizedAdds, normalizedRemoves)

  return {
    ...updatedMessage,
    step: "gmail thread detail label update",
    reason: `Opened target thread, applied Gmail detail-page label UI actions, and returned expected labels (${updatedMessage.labelIds.join(", ")})`,
    logs,
    navigation,
    labelActionTrace: actionReport
  } as any
}

export async function ensureThreadOpenForDetailLabelUpdate(
  messageId: string,
  log: (msg: string) => void = () => {}
): Promise<ThreadDetailLabelUpdateNavigation> {
  const currentMatch = await getCurrentThreadMatchReason(messageId)
  if (currentMatch) {
    log(`Target thread is already open: ${currentMatch}`)
    return {
      step: "target thread already open",
      confirmed: true,
      reason: currentMatch
    }
  }

  if (state.inboxSdk) {
    log("Opening target thread with InboxSDK Router.goto before detail-page label UI action.")
    await state.inboxSdk.Router.goto(state.inboxSdk.Router.NativeRouteIDs.THREAD, {
      threadID: messageId
    })
  } else {
    log("InboxSDK unavailable; opening target thread with DOM/hash fallback before detail-page label UI action.")
    openThreadFromDomFallback(messageId)
  }

  const start = Date.now()
  while (Date.now() - start < 7000) {
    const match = await getCurrentThreadMatchReason(messageId)
    if (match) {
      log(`Confirmed target thread is open after navigation: ${match}`)
      return {
        step: state.inboxSdk ? "inboxsdk thread navigation" : "dom thread navigation",
        confirmed: true,
        reason: match
      }
    }
    await delay(200)
  }

  const debug = await getMainWorldEmailDebug(messageId)
  log(`Failed to confirm target thread after navigation; debug=${JSON.stringify(debug)}`)
  return {
    step: state.inboxSdk ? "inboxsdk thread navigation" : "dom thread navigation",
    confirmed: false,
    reason: "Timed out waiting for Gmail current thread to match requested message id"
  }
}

export async function applyThreadDetailLabelDomActions(
  normalizedAdds: string[],
  normalizedRemoves: string[]
): Promise<ThreadDetailLabelActionReport> {
  const report: ThreadDetailLabelActionReport = {
    success: true,
    clicked: [],
    missing: [],
    matchedCustomLabels: [],
    unmatchedCustomRemoves: [],
    menuItemCount: 0,
    visibleActionCandidates: [],
    logs: []
  }
  const log = (message: string) => report.logs.push(`[thread-detail-label-actions] ${message}`)

  if (normalizedRemoves.includes("INBOX")) {
    const archiveBtn = findThreadDetailActionButton(["archive", "归档"])
    if (safeClick(archiveBtn)) {
      report.clicked.push("archive")
      log("Clicked Archive to remove INBOX.")
      await delay(500)
    } else {
      report.missing.push("archive")
      log("Archive button was not found.")
    }
  }

  if (normalizedAdds.includes("STARRED")) {
    const starBtn = findThreadDetailStarToggleButtons(false)[0]
    if (safeClick(starBtn)) {
      report.clicked.push("star")
      log("Clicked Not starred toggle to add STARRED.")
      if (!(await waitForThreadDetailStarState(true))) {
        report.missing.push("star verification")
        log("Star toggle did not appear starred after clicking.")
      }
    } else {
      report.missing.push("star")
      log("Not starred toggle was not found.")
    }
    await delay(300)
  } else if (normalizedRemoves.includes("STARRED")) {
    const starredButtons = findThreadDetailStarToggleButtons(true)
    if (starredButtons.length > 0) {
      for (const button of starredButtons.slice(0, 10)) {
        safeClick(button)
        await delay(100)
      }
      report.clicked.push("unstar")
      log(`Clicked ${starredButtons.length} Starred toggle(s) to remove STARRED.`)
      if (!(await waitForThreadDetailStarState(false))) {
        report.missing.push("unstar verification")
        log("Starred toggle was still visible after clicking.")
      }
    } else {
      report.missing.push("unstar")
      log("Starred toggle was not found.")
    }
    await delay(300)
  }

  if (normalizedAdds.includes("UNREAD")) {
    const alreadyUnreadBtn = await waitForThreadDetailActionButton(MARK_READ_KEYWORDS, [], 500)
    const unreadBtn = alreadyUnreadBtn
      ? null
      : await waitForThreadDetailActionButton(MARK_UNREAD_KEYWORDS)
    if (alreadyUnreadBtn) {
      report.clicked.push("mark unread already satisfied")
      log("Mark as read action is visible; the message already appears unread.")
    } else if (safeClick(unreadBtn)) {
      report.clicked.push("mark unread")
      log("Clicked Mark as unread to add UNREAD.")
      if (!(await waitForThreadDetailActionButton(MARK_READ_KEYWORDS, [], 1500))) {
        report.missing.push("mark unread verification")
        log("Mark as read action was not visible after clicking Mark as unread.")
      }
    } else {
      report.missing.push("mark unread")
      log("Mark as unread button was not found.")
    }
    await delay(300)
  } else if (normalizedRemoves.includes("UNREAD")) {
    const readBtn = await waitForThreadDetailActionButton(MARK_READ_KEYWORDS)
    if (safeClick(readBtn)) {
      report.clicked.push("mark read")
      log("Clicked Mark as read to remove UNREAD.")
      if (!(await waitForThreadDetailActionButton(MARK_UNREAD_KEYWORDS, [], 1500))) {
        report.missing.push("mark read verification")
        log("Mark as unread action was not visible after clicking Mark as read.")
      }
    } else {
      const alreadyReadBtn = await waitForThreadDetailActionButton(MARK_UNREAD_KEYWORDS, [], 700)
      if (alreadyReadBtn) {
        report.clicked.push("mark read already satisfied")
        log("Mark as unread action is visible; the message already appears read.")
      } else {
        report.missing.push("mark read")
        log("Mark as read button was not found.")
      }
    }
    await delay(300)
  }

  let customRemoves = normalizedRemoves.filter(
    (id) => !systemLabelIds.includes(id)
  )

  if (customRemoves.length === 0) {
    return finalizeThreadDetailReport(report, log)
  }

  customRemoves = Array.from(await removeCustomLabelsFromVisibleThreadDetailChips(
    customRemoves,
    report,
    log
  ))

  if (customRemoves.length === 0) {
    return finalizeThreadDetailReport(report, log)
  }

  const labelsBtn = await waitForThreadDetailActionButton(
    ["labels", "label", "标签"],
    [
      "new label",
      "create new label",
      "more labels",
      "show more",
      "show less",
      "更多标签",
      "新建标签"
    ],
    2500
  )
  if (!safeClick(labelsBtn)) {
    report.missing.push("labels menu button")
    log("Labels menu button was not found.")
    return finalizeThreadDetailReport(report, log)
  }
  report.clicked.push("labels menu button")
  log("Clicked Labels menu button.")
  await delay(400)

  const menuItems = await waitForThreadDetailMenuItems()
  report.menuItemCount = menuItems.length
  log(`Found ${menuItems.length} label menu item candidates.`)

  const unmatchedRemoves = new Set(customRemoves)
  let changedMenuItem = false
  for (const item of menuItems) {
    const names = getThreadDetailMenuItemLabelNames(item)
    const checkbox = item.querySelector(
      'div[role="checkbox"], input[type="checkbox"]'
    )
    const isChecked =
      checkbox?.getAttribute("aria-checked") === "true" ||
      (checkbox as HTMLInputElement)?.checked

    const removeTarget = customRemoves.find((label) => labelNameMatches(label, names))

    if (removeTarget) {
      unmatchedRemoves.delete(removeTarget)
      pushUnique(report.matchedCustomLabels, removeTarget)
    }

    if (removeTarget && isChecked) {
      clickGmailButton(item)
      changedMenuItem = true
      report.clicked.push(`remove label ${removeTarget}`)
      log(`Clicked label menu item to remove "${removeTarget}".`)
      await delay(100)
    }
    if (removeTarget && !isChecked) {
      log(`Label "${removeTarget}" already appeared unchecked.`)
    }
  }

  report.unmatchedCustomRemoves = Array.from(unmatchedRemoves)
  if (report.unmatchedCustomRemoves.length > 0) {
    report.missing.push(`custom labels to remove: ${report.unmatchedCustomRemoves.join(", ")}`)
    log(`Did not find menu items for custom remove labels: ${report.unmatchedCustomRemoves.join(", ")}.`)
  }

  if (changedMenuItem) {
    const applyBtn = findThreadDetailLabelMenuApplyButton()
    if (safeClick(applyBtn)) {
      report.clicked.push("apply labels")
      log("Clicked label menu Apply button.")
    } else {
      report.missing.push("label menu apply button")
      log("Label menu Apply button was not found.")
    }
  }
  await delay(400)
  return finalizeThreadDetailReport(report, log)
}

async function removeCustomLabelsFromVisibleThreadDetailChips(
  customRemoves: string[],
  report: ThreadDetailLabelActionReport,
  log: (message: string) => void
): Promise<Set<string>> {
  const remaining = new Set(customRemoves)
  const chips = collectVisibleThreadDetailLabelChips()
  if (chips.length === 0) {
    log("No visible thread detail label chips were found before opening the Labels menu.")
    return remaining
  }

  for (const label of customRemoves) {
    const chip = chips.find((candidate) =>
      labelNameMatches(label, getThreadDetailLabelChipNames(candidate))
    )
    if (!chip) continue

    pushUnique(report.matchedCustomLabels, label)
    revealThreadDetailLabelChipControls(chip)
    await delay(80)

    const removeButton = findThreadDetailLabelChipRemoveButton(chip, label)
    if (safeClick(removeButton)) {
      remaining.delete(label)
      report.clicked.push(`remove label chip ${label}`)
      log(`Clicked visible label chip remove control for "${label}".`)
      await delay(300)
    } else {
      log(`Found visible label chip "${label}", but no remove control was available; falling back to Labels menu.`)
    }
  }

  return remaining
}

function finalizeThreadDetailReport(
  report: ThreadDetailLabelActionReport,
  log: (message: string) => void
): ThreadDetailLabelActionReport {
  report.success = report.missing.length === 0
  if (!report.success) {
    report.visibleActionCandidates = collectVisibleThreadDetailActionCandidateLabels()
    log(`Visible toolbar/action candidates: ${JSON.stringify(report.visibleActionCandidates)}`)
  }
  return report
}

function collectVisibleThreadDetailLabelChips(): HTMLElement[] {
  const chips = Array.from(document.querySelectorAll<HTMLElement>(
    [
      "div.hN",
      "span.hN",
      "[data-label-name]"
    ].join(", ")
  ))

  return Array.from(new Set(chips))
    .filter((chip) =>
      isVisible(chip) &&
      !isNavigationCandidate(chip) &&
      !chip.closest('[role="menu"], div.J-M') &&
      Boolean(chip.closest("main, [role='main'], div.if, div.iY, div.adn, [data-thread-perm-id]"))
    )
}

function getThreadDetailLabelChipNames(chip: HTMLElement): string[] {
  const values = new Set<string>()
  const add = (value: string | null | undefined) => {
    const text = cleanThreadDetailMenuText(value)
      .replace(/\s*(?:\u00d7|x)\s*$/i, "")
      .trim()
    if (text) values.add(text)
  }

  add(chip.dataset.labelName)
  add(chip.textContent)
  add(chip.getAttribute("aria-label"))
  add(chip.getAttribute("title"))
  chip.querySelectorAll<HTMLElement>("[title], [aria-label], [data-label-name]").forEach((el) => {
    add(el.dataset.labelName)
    add(el.getAttribute("title"))
    add(el.getAttribute("aria-label"))
    add(el.textContent)
  })
  return Array.from(values)
}

function revealThreadDetailLabelChipControls(chip: HTMLElement): void {
  for (const type of ["mouseover", "mouseenter", "mousemove"]) {
    chip.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window
    }))
  }
}

function findThreadDetailLabelChipRemoveButton(
  chip: HTMLElement,
  label: string
): HTMLElement | null {
  const removeKeywords = ["remove", "delete", "移除", "删除"]
  const controls = Array.from(chip.querySelectorAll<HTMLElement>(
    [
      "button",
      '[role="button"]',
      "[aria-label]",
      "[data-tooltip]",
      "[title]",
      ".hO",
      ".hQ"
    ].join(", ")
  )).filter((candidate) =>
    candidate !== chip &&
    isVisible(candidate) &&
    candidate.getAttribute("aria-disabled") !== "true" &&
    candidate.getAttribute("disabled") == null
  )

  const named = controls.find((candidate) => {
    const candidateLabel = getThreadDetailActionCandidateLabel(candidate)
    return removeKeywords.some((keyword) => candidateLabel.includes(keyword)) &&
      (
        candidateLabel.includes(label.toLowerCase()) ||
        candidateLabel.includes(normalizeLabelId(label).toLowerCase()) ||
        candidateLabel.length > 0
      )
  })
  if (named) return named

  if (removeKeywords.some((keyword) => getThreadDetailActionCandidateLabel(chip).includes(keyword))) {
    return chip
  }

  return controls
    .filter((candidate) => {
      const rect = candidate.getBoundingClientRect()
      const text = cleanThreadDetailMenuText(candidate.textContent)
      return rect.width <= 28 && rect.height <= 28 && text.length <= 2
    })
    .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)[0] || null
}

function findThreadDetailActionButton(
  requiredKeywords: string[],
  excludedKeywords: string[] = []
): HTMLElement | null {
  const candidates = collectThreadDetailActionCandidates()
    .sort((a, b) => actionCandidateScore(b) - actionCandidateScore(a))
  return candidates.find((candidate) => {
    const label = getThreadDetailActionCandidateLabel(candidate)
    return requiredKeywords.some((keyword) => label.includes(keyword.toLowerCase())) &&
      !excludedKeywords.some((keyword) => label.includes(keyword.toLowerCase()))
  }) || null
}

async function waitForThreadDetailActionButton(
  requiredKeywords: string[],
  excludedKeywords: string[] = [],
  timeoutMs = 1800
): Promise<HTMLElement | null> {
  const start = Date.now()
  let button = findThreadDetailActionButton(requiredKeywords, excludedKeywords)
  while (!button && Date.now() - start < timeoutMs) {
    await delay(150)
    button = findThreadDetailActionButton(requiredKeywords, excludedKeywords)
  }
  return button
}

function collectThreadDetailActionCandidates(): HTMLElement[] {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(
    [
      "button",
      '[role="button"]',
      ".T-I",
      "[aria-label]",
      "[data-tooltip]",
      "[title]"
    ].join(", ")
  ))

  const roots = candidates
    .map((candidate) =>
      candidate.closest<HTMLElement>('button, [role="button"], .T-I') || candidate
    )
    .filter((candidate) =>
      isVisible(candidate) &&
      isThreadDetailActionCandidate(candidate) &&
      candidate.getAttribute("aria-disabled") !== "true" &&
      candidate.getAttribute("disabled") == null &&
      !candidate.classList.contains("T-I-JE")
    )

  return Array.from(new Set(roots))
}

function collectVisibleThreadDetailActionCandidateLabels(): string[] {
  const actionLabels = collectThreadDetailActionCandidates()
    .map(getThreadDetailActionCandidateLabel)
    .filter(Boolean)

  const menuLabels = collectThreadDetailMenuItems()
    .map((item) => getThreadDetailMenuItemLabelNames(item).join(" ").toLowerCase())
    .filter(Boolean)

  return Array.from(new Set([...actionLabels, ...menuLabels]))
    .slice(0, 30)
}

function getThreadDetailActionCandidateLabel(el: HTMLElement): string {
  return [
    el.getAttribute("aria-label"),
    el.getAttribute("data-tooltip"),
    el.getAttribute("title"),
    el.textContent
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase()
}

function isThreadDetailActionCandidate(el: HTMLElement): boolean {
  if (isNavigationCandidate(el)) return false
  if (el.closest('[role="toolbar"], [gh="mtb"], [gh="tm"], .G-tF')) return true
  return Boolean(el.closest("main, [role='main'], div.if, div.iY, div.adn, [data-thread-perm-id]"))
}

function isNavigationCandidate(el: HTMLElement): boolean {
  return Boolean(el.closest(
    [
      "nav",
      '[role="navigation"]',
      ".aeN",
      ".aeO",
      ".aic",
      ".ain",
      ".aim",
      "[gh='nav']",
      "[role='banner']"
    ].join(", ")
  ))
}

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) target.push(value)
}

function findThreadDetailStarToggleButtons(currentlyStarred: boolean): HTMLElement[] {
  const candidates = collectThreadDetailStarCandidates()
    .filter((candidate) => {
      const label = getThreadDetailActionCandidateLabel(candidate)
      return currentlyStarred
        ? hasLabelKeyword(label, ["starred", "已加星标"]) &&
            !hasLabelKeyword(label, ["not starred", "未加星标"])
        : hasLabelKeyword(label, ["not starred", "未加星标"])
    })
    .sort((a, b) => starCandidateScore(b) - starCandidateScore(a))

  return Array.from(new Set(candidates))
}

function collectThreadDetailStarCandidates(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(
    [
      '[aria-label*="Starred"]',
      '[aria-label*="starred"]',
      '[aria-label*="已加星标"]',
      '[aria-label*="未加星标"]',
      '[data-tooltip*="Starred"]',
      '[data-tooltip*="starred"]',
      '[data-tooltip*="已加星标"]',
      '[data-tooltip*="未加星标"]',
      '[title*="Starred"]',
      '[title*="starred"]',
      '[title*="已加星标"]',
      '[title*="未加星标"]'
    ].join(", ")
  ))
    .map((candidate) =>
      candidate.closest<HTMLElement>('[role="button"], button, .T-KT, .zd') ||
      candidate
    )
    .filter((candidate) =>
      isVisible(candidate) &&
      isThreadDetailActionCandidate(candidate) &&
      candidate.getAttribute("aria-disabled") !== "true" &&
      candidate.getAttribute("disabled") == null
    )
}

async function waitForThreadDetailStarState(starred: boolean): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < 1500) {
    const starredCount = findThreadDetailStarToggleButtons(true).length
    const notStarredCount = findThreadDetailStarToggleButtons(false).length
    if (starred && starredCount > 0) return true
    if (!starred && starredCount === 0 && notStarredCount > 0) return true
    await delay(150)
  }
  return false
}

function starCandidateScore(el: HTMLElement): number {
  let score = actionCandidateScore(el)
  if (el.closest("[data-thread-perm-id], [data-legacy-thread-id]")) score += 8
  if (el.closest("[data-message-id], [data-legacy-message-id], .adn")) score += 8
  if (el.closest("tr.zA")) score += 4
  if (el.classList.contains("T-KT") || el.classList.contains("zd")) score += 4
  return score
}

function hasLabelKeyword(label: string, keywords: string[]): boolean {
  return keywords.some((keyword) => label.includes(keyword.toLowerCase()))
}

function actionCandidateScore(el: HTMLElement): number {
  let score = 0
  if (el.closest('[role="toolbar"], [gh="mtb"]')) score += 6
  if (el.closest('main, [role="main"]')) score += 2
  if (el.closest('nav, [role="navigation"]')) score -= 6
  return score
}

async function waitForThreadDetailMenuItems(): Promise<HTMLElement[]> {
  const start = Date.now()
  let items: HTMLElement[] = []
  while (Date.now() - start < 2500) {
    items = collectThreadDetailMenuItems()
    if (items.length > 0) return items
    await delay(150)
  }
  return items
}

function collectThreadDetailMenuItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(
    [
      'div[role="menuitemcheckbox"]',
      'div[role="menu"] div[role="menuitem"]',
      "div.J-N"
    ].join(", ")
  )).filter(isVisible)
}

function getThreadDetailMenuItemLabelNames(item: HTMLElement): string[] {
  const values = new Set<string>()
  const add = (value: string | null | undefined) => {
    const text = cleanThreadDetailMenuText(value)
    if (text) values.add(text)
  }

  add(item.textContent)
  add(item.getAttribute("aria-label"))
  add(item.getAttribute("title"))
  item.querySelectorAll<HTMLElement>("[title], [aria-label]").forEach((el) => {
    add(el.getAttribute("title"))
    add(el.getAttribute("aria-label"))
    add(el.textContent)
  })
  return Array.from(values)
}

function findThreadDetailLabelMenuApplyButton(): HTMLElement | null {
  const buttons = Array.from(document.querySelectorAll<HTMLElement>(
    [
      'div[role="menu"] button',
      'div[role="menu"] [role="button"]',
      'div[role="menu"] .T-I-atl',
      'div.J-M button',
      'div.J-M [role="button"]',
      'div.J-M .T-I-atl'
    ].join(", ")
  ))

  const exact = buttons.find((button) => {
    const label = [
      button.textContent,
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      button.getAttribute("data-tooltip")
    ].filter(Boolean).join(" ").toLowerCase()
    return label.includes("apply") || label.includes("应用") || label.includes("套用")
  })
  return exact || buttons.find((button) => button.classList.contains("T-I-atl")) || null
}

async function getCurrentThreadMatchReason(messageId: string): Promise<string | null> {
  const detailDomMatches = currentThreadDetailDomMatches(messageId)
  const snapshot = await (mainWorldBridge.call
    ? mainWorldBridge.call("snapshot").catch(() => undefined)
    : undefined)
  const snapshotThreadDetailVisible =
    snapshot?.threadDetailVisible === true || isCurrentThreadDetailVisible()
  if (snapshotThreadDetailVisible && detailDomMatches && snapshot?.threadId === messageId) {
    return `snapshot.threadId=${snapshot.threadId}`
  }
  if (snapshotThreadDetailVisible && detailDomMatches && snapshot?.emailId === messageId) {
    return `snapshot.emailId=${snapshot.emailId}`
  }

  const debug = await getMainWorldEmailDebug(messageId)
  const debugThreadDetailVisible =
    (isRecord(debug) && debug.threadDetailVisible === true) ||
    isCurrentThreadDetailVisible()
  if (isRecord(debug)) {
    if (debugThreadDetailVisible && detailDomMatches && debug.currentLegacyMatchesRequest === true) return "gmail-js debug currentLegacyMatchesRequest=true"
    if (debugThreadDetailVisible && detailDomMatches && debug.domThreadId === messageId) return `debug.domThreadId=${debug.domThreadId}`
    if (debugThreadDetailVisible && detailDomMatches && debug.domEmailId === messageId) return `debug.domEmailId=${debug.domEmailId}`
    if (debugThreadDetailVisible && detailDomMatches && debug.gmailNewThreadId === messageId) return `debug.gmailNewThreadId=${debug.gmailNewThreadId}`
    if (debugThreadDetailVisible && detailDomMatches && debug.gmailNewEmailId === messageId) return `debug.gmailNewEmailId=${debug.gmailNewEmailId}`
  }

  return isCurrentThreadDetailVisible() && detailDomMatches && window.location.hash.includes(messageId)
    ? `location hash includes ${messageId}`
    : null
}

function isCurrentThreadDetailVisible(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>("h2.hP, div.adn"))
    .some(isVisible)
}

function currentThreadDetailDomMatches(messageId: string): boolean {
  const normalizedMessageId = normalizeDomGmailId(messageId)
  if (!normalizedMessageId || !isCurrentThreadDetailVisible()) return false

  return Array.from(document.querySelectorAll<HTMLElement>(
    "[data-thread-perm-id], [data-legacy-thread-id], [data-thread-id], [data-legacy-message-id], [data-message-id]"
  )).some((el) => {
    if (el.closest("tr.zA, [role='row']")) return false
    const ids = [
      el.dataset.threadPermId,
      el.dataset.legacyThreadId,
      el.dataset.threadId,
      el.dataset.legacyMessageId,
      el.dataset.messageId
    ].map(normalizeDomGmailId)
    return ids.includes(normalizedMessageId)
  })
}

function normalizeDomGmailId(value: string | undefined): string {
  return (value || "")
    .replace(/^#/, "")
    .replace(/^thread-[af]:/i, "")
    .replace(/^msg-[af]:/i, "")
}

function normalizeRequestedLabelIds(labelIds: string[]): string[] {
  return [
    ...new Set(labelIds.map(normalizeLabelId).filter(Boolean))
  ]
}

function getCompleteExistingLabelIds(data: unknown, messageId: string): string[] {
  const dataLabels = isStringArray((data as any)?.labels)
    ? (data as any).labels
    : []
  const visibleLabels = getVisibleLabelIds(messageId)
  return [
    ...new Set(
      [...dataLabels, ...visibleLabels]
        .map(normalizeLabelId)
        .filter(Boolean)
    )
  ]
}

function getCurrentThreadRouteLabelHints(): string[] {
  const rawHash = window.location.hash || ""
  const rawPath = rawHash.replace(/^#/, "")
  const rawSegments = rawPath.split("/")
  const route = decodeGmailHashSegment(rawSegments[0]).toLowerCase()

  const hints: string[] = []
  if (route === "inbox") hints.push("INBOX")
  if (route === "starred") hints.push("STARRED")
  if (route === "important") hints.push("IMPORTANT")
  if (route === "sent") hints.push("SENT")
  if (route === "trash") hints.push("TRASH")
  if (route === "spam") hints.push("SPAM")
  if (route === "label" && rawSegments[1]) {
    hints.push(decodeGmailHashSegment(rawSegments[1]))
  }

  return [...new Set(hints.map(normalizeLabelId).filter(Boolean))]
}

function isSupportedDetailAddLabel(label: string): boolean {
  return label === "UNREAD" || label === "STARRED"
}

function isSupportedDetailRemoveLabel(label: string): boolean {
  return (
    label === "INBOX" ||
    label === "UNREAD" ||
    label === "STARRED" ||
    isUserLabel(label)
  )
}

function isUserLabel(label: string): boolean {
  const knownSystemIds = new Set(
    systemLabels.flatMap((systemLabel) => [
      systemLabel.id,
      normalizeLabelId(systemLabel.id),
      normalizeLabelId(systemLabel.name)
    ])
  )
  return !knownSystemIds.has(label) && !knownSystemIds.has(normalizeLabelId(label))
}

function unsupportedThreadDetailLabelChangeResponse(
  messageId: string,
  unsupportedAdds: string[],
  unsupportedRemoves: string[],
  logs: string[],
  navigation: ThreadDetailLabelUpdateNavigation
): GmailClientError {
  const reason = [
    "WXT's thread-detail label helper can mark read/unread, star/unstar, archive, and remove existing custom labels, but it cannot add Gmail labels without Gmail API authorization.",
    unsupportedAdds.length > 0 ? `Unsupported addLabelIds: ${unsupportedAdds.join(", ")}` : "",
    unsupportedRemoves.length > 0 ? `Unsupported removeLabelIds: ${unsupportedRemoves.join(", ")}` : ""
  ].filter(Boolean).join(" ")

  showGmailAgentNotice(
    "Mail Agent cannot complete this thread-detail label change",
    `${reason} The agent has been told not to retry.`
  )

  return {
    error: `${reason} A notice was shown to the user; do not retry this request in WXT.`,
    nonRetryable: true,
    userNotified: true,
    step: "unsupported gmail thread detail label update",
    reason,
    messageId,
    unsupportedAddLabelIds: unsupportedAdds,
    unsupportedRemoveLabelIds: unsupportedRemoves,
    logs,
    navigation
  } as any
}

function buildExpectedLabelIds(
  existingLabels: string[],
  normalizedAdds: string[],
  normalizedRemoves: string[]
): string[] {
  return [
    ...new Set([
      ...existingLabels.filter((label) => !normalizedRemoves.includes(label)),
      ...normalizedAdds
    ])
  ]
}

function emptyThreadDetailLabelActionTrace(): ThreadDetailLabelActionReport {
  return {
    success: true,
    clicked: [],
    missing: [],
    matchedCustomLabels: [],
    unmatchedCustomRemoves: [],
    menuItemCount: 0,
    visibleActionCandidates: [],
    logs: []
  }
}

function cleanThreadDetailMenuText(value: string | null | undefined): string {
  return (value || "")
    .replace(/\s+/g, " ")
    .replace(/\(\d+\)$/, "")
    .trim()
}

function labelNameMatches(target: string, names: string[]): boolean {
  const normalizedTarget = normalizeLabelId(target).toLowerCase()
  return names.some((name) => {
    const normalizedName = normalizeLabelId(name).toLowerCase()
    return normalizedName === normalizedTarget || name.toLowerCase() === target.toLowerCase()
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function decodeGmailHashSegment(value: string | undefined): string {
  if (!value) return ""
  try {
    return decodeURIComponent(value.replace(/\+/g, " "))
  } catch {
    return value
  }
}
