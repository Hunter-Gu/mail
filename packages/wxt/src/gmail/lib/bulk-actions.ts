import type { GmailMessage } from "agent"

import { delay } from "../state"
import { clickGmailButton, isVisible, safeClick } from "./dom"
import {
  MARK_READ_KEYWORDS,
  MARK_UNREAD_KEYWORDS,
  collectVisibleActionCandidateLabels,
  waitForGmailActionButton
} from "./label-actions"
import { labelIdToName, normalizeLabelId, systemLabels } from "./label-model"
import {
  getVisibleThreadRows,
  isLegacyThreadId
} from "./thread-fallbacks"

export type BulkLabelActionReport = {
  success: boolean
  updatedIds: string[]
  messages: GmailMessage[]
  failed: Array<{ id: string; error: string }>
  clicked: string[]
  missing: string[]
  selectedIds: string[]
  logs: string[]
  visibleActionCandidates: string[]
}

export async function applyBulkListLabelActions(
  messageIds: string[],
  addLabelIds: string[],
  removeLabelIds: string[]
): Promise<BulkLabelActionReport> {
  const normalizedIds = unique(messageIds.map(cleanLegacyId).filter(isLegacyThreadId))
  const normalizedChanges = normalizeRequestedLabelChanges(addLabelIds, removeLabelIds)
  const normalizedAdds = normalizedChanges.adds
  const normalizedRemoves = normalizedChanges.removes
  const report: BulkLabelActionReport = {
    success: true,
    updatedIds: [],
    messages: [],
    failed: [],
    clicked: [],
    missing: [],
    selectedIds: [],
    logs: [],
    visibleActionCandidates: []
  }
  const log = (message: string) => report.logs.push(`[bulk-actions] ${message}`)
  normalizedChanges.logs.forEach(log)

  if (normalizedIds.length === 0) {
    report.success = false
    report.missing.push("message ids")
    log("No valid legacy Gmail thread ids were provided.")
    return report
  }

  const moveToLabels = normalizedAdds.filter(isMoveToLabel)
  const unsupportedAdds = normalizedAdds.filter((label) =>
    !isToolbarHandledAdd(label) && !isMoveToLabel(label)
  )
  const unsupportedRemoves = normalizedRemoves.filter((label) =>
    !isToolbarHandledRemove(label) && !isMoreMenuHandledRemove(label)
  )
  if (unsupportedAdds.length > 0 || unsupportedRemoves.length > 0) {
    report.success = false
    report.missing.push(
      `unsupported list label actions: add=${unsupportedAdds.join(",") || "none"} remove=${unsupportedRemoves.join(",") || "none"}`
    )
    log("Supported list actions are read/unread, star/unstar, mark important/not important, archive/move to inbox, and Move to one custom label.")
    return report
  }

  if (moveToLabels.length > 1) {
    report.success = false
    report.missing.push(`multiple move-to labels: ${moveToLabels.join(", ")}`)
    log("Gmail's Move to action supports one destination label per bulk action.")
    return report
  }

  const conflictingLabels = normalizedAdds.filter((label) =>
    normalizedRemoves.includes(label)
  )
  if (conflictingLabels.length > 0) {
    report.success = false
    report.missing.push(`conflicting label changes: ${conflictingLabels.join(", ")}`)
    log("Cannot add and remove the same label in one bulk action.")
    return report
  }

  const selection = await selectVisibleThreadRows(normalizedIds, log)
  report.selectedIds = selection.selectedIds
  for (const id of selection.missingIds) {
    report.failed.push({
      id,
      error: "Thread row is not visible in the current Gmail list page."
    })
  }
  if (selection.missingIds.length > 0) {
    report.success = false
    report.missing.push(`visible rows: ${selection.missingIds.join(", ")}`)
    report.visibleActionCandidates = collectVisibleActionCandidateLabels()
    await clearSelectedThreadRows(selection.selectedRows)
    return report
  }

  if (normalizedRemoves.includes("UNREAD")) {
    await clickBulkToolbarAction({
      name: "mark read",
      requiredKeywords: MARK_READ_KEYWORDS,
      verifyKeywords: MARK_UNREAD_KEYWORDS,
      report,
      log
    })
  } else if (normalizedAdds.includes("UNREAD")) {
    await clickBulkToolbarAction({
      name: "mark unread",
      requiredKeywords: MARK_UNREAD_KEYWORDS,
      verifyKeywords: MARK_READ_KEYWORDS,
      report,
      log
    })
  }

  if (normalizedAdds.includes("STARRED")) {
    await applyStarAction({
      starred: true,
      name: "add star",
      requiredKeywords: ["add star", "star", "加星", "添加星标", "加上星标"],
      excludedKeywords: ["remove star", "unstar", "取消星标", "移除星标"],
      selectedRows: selection.selectedRows,
      report,
      log
    })
  } else if (normalizedRemoves.includes("STARRED")) {
    await applyStarAction({
      starred: false,
      name: "remove star",
      requiredKeywords: ["remove star", "unstar", "取消星标", "移除星标"],
      selectedRows: selection.selectedRows,
      report,
      log
    })
  }

  if (normalizedAdds.includes("IMPORTANT")) {
    await clickMoreMenuAction({
      name: "mark important",
      requiredKeywords: ["mark as important", "mark important", "标记为重要", "设为重要"],
      excludedKeywords: ["not important", "unimportant", "不重要"],
      report,
      log
    })
  } else if (normalizedRemoves.includes("IMPORTANT")) {
    await clickMoreMenuAction({
      name: "mark not important",
      requiredKeywords: ["mark as not important", "not important", "unimportant", "标记为不重要", "取消重要"],
      report,
      log
    })
  }

  if (normalizedAdds.includes("INBOX")) {
    await clickBulkToolbarAction({
      name: "move to inbox",
      requiredKeywords: ["move to inbox", "移至收件箱", "移到收件箱"],
      report,
      log
    })
  } else if (normalizedRemoves.includes("INBOX")) {
    await clickBulkToolbarAction({
      name: "archive",
      requiredKeywords: ["archive", "归档"],
      report,
      log
    })
  }

  const moveToLabel = moveToLabels[0]
  if (moveToLabel) {
    await clickMoveToLabel(moveToLabel, report, log)
  }

  report.success = report.missing.length === 0
  if (!report.success) {
    report.visibleActionCandidates = collectVisibleActionCandidateLabels()
    await clearSelectedThreadRows(selection.selectedRows)
    return report
  }

  report.updatedIds = normalizedIds
  report.messages = normalizedIds.map((id) => ({
    id,
    threadId: id,
    labelIds: buildExpectedLabelIds(normalizedAdds, normalizedRemoves)
  }))
  return report
}

async function clickMoveToLabel(
  label: string,
  report: BulkLabelActionReport,
  log: (message: string) => void
): Promise<void> {
  const button = await waitForGmailActionButton(
    ["move to", "move", "移至", "移到", "移动到", "移動到"],
    ["move to inbox", "移至收件箱"],
    2500
  )
  if (!safeClick(button)) {
    report.missing.push("move to")
    log("Could not find Gmail bulk toolbar Move to action.")
    return
  }

  report.clicked.push("move to")
  log("Clicked Gmail bulk toolbar Move to action.")
  await delay(400)

  const menuItems = await waitForMenuItems()
  const target = findLabelMenuItem(label, menuItems)
  if (!target) {
    report.missing.push(`move target label ${label}`)
    log(`Could not find Move to menu item for "${label}".`)
    closeOpenMenu()
    return
  }

  clickGmailButton(target)
  report.clicked.push(`move to ${label}`)
  log(`Clicked Move to menu item for "${label}".`)
  await delay(500)
}

async function clickMoreMenuAction(args: {
  name: string
  requiredKeywords: string[]
  excludedKeywords?: string[]
  recordFailure?: boolean
  report: BulkLabelActionReport
  log: (message: string) => void
}): Promise<boolean> {
  const button = await waitForGmailActionButton(
    ["more email options", "more options", "more", "更多", "更多操作"],
    ["show more messages", "older", "newer"],
    2500
  )
  if (!safeClick(button)) {
    if (args.recordFailure !== false) {
      args.report.missing.push(`more menu ${args.name}`)
    }
    args.log(`Could not find Gmail bulk toolbar More action for "${args.name}".`)
    return false
  }

  args.report.clicked.push("more")
  args.log(`Clicked Gmail bulk toolbar More action for "${args.name}".`)
  await delay(400)

  const menuItems = await waitForMenuItems()
  const target = menuItems.find((item) =>
    menuItemMatchesKeywords(
      item,
      args.requiredKeywords,
      args.excludedKeywords ?? []
    )
  )
  if (!target) {
    if (args.recordFailure !== false) {
      args.report.missing.push(args.name)
    }
    args.log(`Could not find More menu item for "${args.name}".`)
    closeOpenMenu()
    return false
  }

  clickGmailButton(target)
  args.report.clicked.push(args.name)
  args.log(`Clicked More menu item for "${args.name}".`)
  await delay(500)
  return true
}

async function applyStarAction(args: {
  starred: boolean
  name: string
  requiredKeywords: string[]
  excludedKeywords?: string[]
  selectedRows: HTMLElement[]
  report: BulkLabelActionReport
  log: (message: string) => void
}): Promise<void> {
  const moreSucceeded = await clickMoreMenuAction({
    name: args.name,
    requiredKeywords: args.requiredKeywords,
    excludedKeywords: args.excludedKeywords,
    recordFailure: false,
    report: args.report,
    log: args.log
  })
  if (moreSucceeded) {
    const verified = await waitForRowsStarState(args.selectedRows, args.starred)
    if (verified) return
    args.log(`More menu item for "${args.name}" did not visibly update selected rows; falling back to row star controls.`)
  }

  args.log(`Falling back to visible row star controls for "${args.name}".`)
  const failedRows: string[] = []
  let clicked = 0

  for (const row of args.selectedRows) {
    const currentTarget = findRowStarControl(row, args.starred ? "not-starred" : "starred")
    if (currentTarget) {
      clickGmailButton(currentTarget)
      clicked++
      await delay(120)
      continue
    }

    const alreadySatisfied = findRowStarControl(row, args.starred ? "starred" : "not-starred")
    if (alreadySatisfied) {
      args.log(`Row ${getRowThreadIds(row)[0] || "(unknown)"} already satisfied "${args.name}".`)
      continue
    }

    failedRows.push(getRowThreadIds(row)[0] || "(unknown)")
  }

  if (failedRows.length > 0) {
    args.report.missing.push(args.name)
    args.log(`Could not find row star controls for: ${failedRows.join(", ")}.`)
    return
  }

  if (clicked > 0) {
    args.report.clicked.push(`${args.name} row controls`)
    args.log(`Clicked ${clicked} visible row star control(s) for "${args.name}".`)
  }
}

async function waitForRowsStarState(
  rows: HTMLElement[],
  starred: boolean,
  timeoutMs = 1800
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (rows.every((row) =>
      Boolean(findRowStarControl(row, starred ? "starred" : "not-starred"))
    )) {
      return true
    }
    await delay(150)
  }
  return false
}

async function clickBulkToolbarAction(args: {
  name: string
  requiredKeywords: string[]
  verifyKeywords?: string[]
  report: BulkLabelActionReport
  log: (message: string) => void
}): Promise<void> {
  const button = await waitForGmailActionButton(args.requiredKeywords, [], 2500)
  if (!safeClick(button)) {
    args.report.missing.push(args.name)
    args.log(`Could not find Gmail bulk toolbar action "${args.name}".`)
    return
  }

  args.report.clicked.push(args.name)
  args.log(`Clicked Gmail bulk toolbar action "${args.name}".`)
  await delay(500)

  if (args.verifyKeywords) {
    const verified = await waitForGmailActionButton(args.verifyKeywords, [], 1500)
    if (!verified) {
      args.report.missing.push(`${args.name} verification`)
      args.log(`Could not verify Gmail toolbar changed state after "${args.name}".`)
    }
  }
}

async function selectVisibleThreadRows(
  messageIds: string[],
  log: (message: string) => void
): Promise<{
  selectedIds: string[]
  missingIds: string[]
  selectedRows: HTMLElement[]
}> {
  const selectedIds: string[] = []
  const missingIds: string[] = []
  const selectedRows: HTMLElement[] = []

  for (const id of messageIds) {
    const row = findVisibleThreadRow(id)
    if (!row) {
      missingIds.push(id)
      continue
    }

    if (!isThreadRowSelected(row)) {
      const checkbox = findThreadRowCheckbox(row)
      if (!checkbox) {
        missingIds.push(id)
        log(`Could not find row checkbox for ${id}.`)
        continue
      }
      clickGmailButton(checkbox)
      await waitForRowSelection(row, true)
    }

    if (isThreadRowSelected(row)) {
      selectedIds.push(id)
      selectedRows.push(row)
    } else {
      missingIds.push(id)
      log(`Gmail row for ${id} did not become selected after clicking.`)
    }
  }

  await delay(250)
  log(`Selected ${selectedIds.length}/${messageIds.length} visible Gmail row(s).`)
  return { selectedIds, missingIds, selectedRows }
}

async function clearSelectedThreadRows(rows: HTMLElement[]): Promise<void> {
  for (const row of rows) {
    if (!isThreadRowSelected(row)) continue
    const checkbox = findThreadRowCheckbox(row)
    if (checkbox) {
      clickGmailButton(checkbox)
      await waitForRowSelection(row, false)
    }
  }
}

function findVisibleThreadRow(messageId: string): HTMLElement | null {
  const normalizedId = cleanLegacyId(messageId)
  for (const row of getVisibleThreadRows()) {
    if (getRowThreadIds(row).includes(normalizedId)) return row
  }
  return null
}

function getRowThreadIds(row: HTMLElement): string[] {
  const ids = [
    row.dataset.threadId,
    row.dataset.legacyThreadId,
    row.getAttribute("data-thread-id") || undefined,
    row.getAttribute("data-legacy-thread-id") || undefined
  ]

  row.querySelectorAll<HTMLElement>("[data-thread-id], [data-legacy-thread-id], a[href]").forEach((el) => {
    ids.push(el.dataset.threadId)
    ids.push(el.dataset.legacyThreadId)
    const href = el.getAttribute("href") || ""
    const match = href.match(/(?:\/|%2F)([0-9a-fA-F]{16})(?:[/?#&]|$)/) ||
      href.match(/#\w+(?:\/[\w\-:;%]+)*\/([0-9a-fA-F]{16})/)
    if (match?.[1]) ids.push(match[1])
  })

  return unique(ids.map(cleanLegacyId).filter(isLegacyThreadId))
}

function findThreadRowCheckbox(row: HTMLElement): HTMLElement | null {
  const candidates = Array.from(row.querySelectorAll<HTMLElement>(
    [
      'div[role="checkbox"]',
      'span[role="checkbox"]',
      'input[type="checkbox"]',
      '[aria-label*="Select"]',
      '[data-tooltip*="Select"]',
      '[title*="Select"]',
      '[aria-label*="选择"]',
      '[data-tooltip*="选择"]',
      '[title*="选择"]'
    ].join(", ")
  ))

  return candidates.find((candidate) =>
    isVisible(candidate) &&
    !isStarCandidate(candidate) &&
    candidate.getAttribute("aria-disabled") !== "true" &&
    candidate.getAttribute("disabled") == null
  ) || null
}

function isThreadRowSelected(row: HTMLElement): boolean {
  if (row.classList.contains("x7")) return true
  return Boolean(
    row.querySelector('[role="checkbox"][aria-checked="true"], input[type="checkbox"]:checked')
  )
}

async function waitForRowSelection(
  row: HTMLElement,
  selected: boolean
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < 1500) {
    if (isThreadRowSelected(row) === selected) return true
    await delay(100)
  }
  return false
}

function isStarCandidate(el: HTMLElement): boolean {
  const label = [
    el.getAttribute("aria-label"),
    el.getAttribute("data-tooltip"),
    el.getAttribute("title")
  ].filter(Boolean).join(" ").toLowerCase()
  return label.includes("star") || label.includes("星标")
}

function findRowStarControl(
  row: HTMLElement,
  state: "starred" | "not-starred"
): HTMLElement | null {
  const candidates = Array.from(row.querySelectorAll<HTMLElement>(
    [
      '[aria-label*="Star"]',
      '[aria-label*="star"]',
      '[aria-label*="星标"]',
      '[aria-label*="星標"]',
      '[data-tooltip*="Star"]',
      '[data-tooltip*="star"]',
      '[data-tooltip*="星标"]',
      '[data-tooltip*="星標"]',
      '[title*="Star"]',
      '[title*="star"]',
      '[title*="星标"]',
      '[title*="星標"]',
      ".T-KT",
      ".zd"
    ].join(", ")
  ))
    .map((candidate) =>
      candidate.closest<HTMLElement>('[role="button"], button, .T-KT, .zd') ||
      candidate
    )
    .filter((candidate) =>
      isVisible(candidate) &&
      candidate.getAttribute("aria-disabled") !== "true" &&
      candidate.getAttribute("disabled") == null
    )

  return Array.from(new Set(candidates)).find((candidate) => {
    const label = getElementLabel(candidate)
    return state === "not-starred"
      ? isNotStarredLabel(label)
      : isStarredLabel(label)
  }) || null
}

function isNotStarredLabel(label: string): boolean {
  return (
    label.includes("not starred") ||
    label.includes("not star") ||
    label.includes("unstarred") ||
    label.includes("未加星标") ||
    label.includes("未加星標")
  )
}

function isStarredLabel(label: string): boolean {
  return (
    (
      label.includes("starred") ||
      label.includes("star") ||
      label.includes("已加星标") ||
      label.includes("已加星標")
    ) &&
    !isNotStarredLabel(label)
  )
}

async function waitForMenuItems(): Promise<HTMLElement[]> {
  const start = Date.now()
  let items: HTMLElement[] = []
  while (Date.now() - start < 2500) {
    items = collectMenuItems()
    if (items.length > 0) return items
    await delay(150)
  }
  return items
}

function collectMenuItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(
    [
      'div[role="menuitem"]',
      'div[role="menuitemcheckbox"]',
      "div.J-N"
    ].join(", ")
  )).filter((item) =>
    isVisible(item) &&
    item.getAttribute("aria-disabled") !== "true" &&
    item.getAttribute("disabled") == null
  )
}

function getMenuItemLabelNames(item: HTMLElement): string[] {
  const values = new Set<string>()
  const add = (value: string | null | undefined) => {
    const text = cleanMenuText(value)
    if (text) values.add(text)
  }

  add(item.textContent)
  add(item.getAttribute("aria-label"))
  add(item.getAttribute("title"))
  item.querySelectorAll<HTMLElement>("[title], [aria-label], [data-tooltip]").forEach((el) => {
    add(el.textContent)
    add(el.getAttribute("aria-label"))
    add(el.getAttribute("title"))
    add(el.getAttribute("data-tooltip"))
  })
  return Array.from(values)
}

function findLabelMenuItem(label: string, menuItems: HTMLElement[]): HTMLElement | null {
  return menuItems.find((item) =>
    labelNameMatches(label, getMenuItemLabelNames(item))
  ) || null
}

function getElementLabel(el: HTMLElement): string {
  return [
    el.textContent,
    el.getAttribute("aria-label"),
    el.getAttribute("title"),
    el.getAttribute("data-tooltip")
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase()
}

function menuItemMatchesKeywords(
  item: HTMLElement,
  requiredKeywords: string[],
  excludedKeywords: string[] = []
): boolean {
  const label = getMenuItemLabelNames(item)
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase()
  return requiredKeywords.some((keyword) => label.includes(keyword.toLowerCase())) &&
    !excludedKeywords.some((keyword) => label.includes(keyword.toLowerCase()))
}

function labelNameMatches(target: string, names: string[]): boolean {
  const targetAliases = getLabelTargetAliases(target)
  return names.some((name) => {
    const normalizedName = normalizeComparableLabel(name)
    return targetAliases.some((alias) =>
      normalizeComparableLabel(alias) === normalizedName ||
      cleanMenuText(alias).toLowerCase() === cleanMenuText(name).toLowerCase()
    )
  })
}

function getLabelTargetAliases(target: string): string[] {
  const normalized = normalizeLabelId(target)
  return unique([
    target,
    normalized,
    labelIdToName(target),
    labelIdToName(normalized)
  ].map(cleanMenuText).filter(Boolean))
}

function normalizeComparableLabel(value: string): string {
  return normalizeLabelId(cleanMenuText(value)).toLowerCase()
}

function cleanMenuText(value: string | null | undefined): string {
  return (value || "")
    .replace(/\s+/g, " ")
    .replace(/\(\d+\)$/, "")
    .trim()
}

function closeOpenMenu(): void {
  document.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true
  }))
}

function buildExpectedLabelIds(
  normalizedAdds: string[],
  normalizedRemoves: string[]
): string[] {
  return unique(normalizedAdds.filter((label) => !normalizedRemoves.includes(label)))
}

type NormalizedLabelChanges = {
  adds: string[]
  removes: string[]
  logs: string[]
}

function normalizeRequestedLabelChanges(
  addLabelIds: string[],
  removeLabelIds: string[]
): NormalizedLabelChanges {
  const adds: string[] = []
  const removes: string[] = []
  const logs: string[] = []

  for (const label of addLabelIds) {
    applyRequestedLabelIntent(label, "add", adds, removes, logs)
  }
  for (const label of removeLabelIds) {
    applyRequestedLabelIntent(label, "remove", adds, removes, logs)
  }

  return {
    adds: unique(adds),
    removes: unique(removes),
    logs
  }
}

function applyRequestedLabelIntent(
  rawLabel: string,
  operation: "add" | "remove",
  adds: string[],
  removes: string[],
  logs: string[]
): void {
  let label = normalizeLabelId(rawLabel.trim())
  if (!label) return

  if (isArchiveAlias(label)) {
    if (operation === "add") {
      removes.push("INBOX")
      logs.push(`Mapped add ${rawLabel} to remove INBOX.`)
    } else {
      adds.push("INBOX")
      logs.push(`Mapped remove ${rawLabel} to add INBOX.`)
    }
    return
  }

  if (isReadAlias(label)) {
    if (operation === "add") {
      removes.push("UNREAD")
      logs.push(`Mapped add ${rawLabel} to remove UNREAD.`)
    } else {
      adds.push("UNREAD")
      logs.push(`Mapped remove ${rawLabel} to add UNREAD.`)
    }
    return
  }

  if (isUnreadAlias(label)) {
    if (operation === "add") {
      adds.push("UNREAD")
    } else {
      removes.push("UNREAD")
    }
    return
  }

  if (isStarAlias(label)) {
    label = "STARRED"
  } else if (isImportantAlias(label)) {
    label = "IMPORTANT"
  }

  if (operation === "add") {
    adds.push(label)
  } else {
    removes.push(label)
  }
}

function isArchiveAlias(label: string): boolean {
  const normalized = label.trim().toLowerCase()
  return ["archive", "archived", "归档", "封存"].includes(normalized)
}

function isReadAlias(label: string): boolean {
  const normalized = label.trim().toLowerCase()
  return [
    "read",
    "read_label",
    "mark_read",
    "mark as read",
    "已读",
    "已讀"
  ].includes(normalized)
}

function isUnreadAlias(label: string): boolean {
  const normalized = label.trim().toLowerCase()
  return [
    "unread",
    "unread_label",
    "mark_unread",
    "mark as unread",
    "未读",
    "未讀"
  ].includes(normalized)
}

function isStarAlias(label: string): boolean {
  const normalized = label.trim().toLowerCase()
  return [
    "star",
    "starred",
    "add_star",
    "add star",
    "星标",
    "星標"
  ].includes(normalized)
}

function isImportantAlias(label: string): boolean {
  const normalized = label.trim().toLowerCase()
  return [
    "important",
    "mark_important",
    "mark important",
    "mark as important",
    "重要"
  ].includes(normalized)
}

function isToolbarHandledAdd(label: string): boolean {
  return label === "UNREAD" || label === "INBOX" || isMoreMenuHandledAdd(label)
}

function isToolbarHandledRemove(label: string): boolean {
  return label === "UNREAD" || label === "INBOX" || isMoreMenuHandledRemove(label)
}

function isMoreMenuHandledAdd(label: string): boolean {
  return label === "STARRED" || label === "IMPORTANT"
}

function isMoreMenuHandledRemove(label: string): boolean {
  return label === "STARRED" || label === "IMPORTANT"
}

function isMoveToLabel(label: string): boolean {
  return Boolean(label) && !isKnownSystemLabel(label)
}

function isKnownSystemLabel(label: string): boolean {
  const normalized = normalizeLabelId(label)
  return systemLabels.some((systemLabel) =>
    systemLabel.id === normalized ||
    normalizeLabelId(systemLabel.name) === normalized ||
    systemLabel.name.toLowerCase() === label.toLowerCase()
  )
}

function cleanLegacyId(value: string | undefined): string {
  return (value || "")
    .replace(/^#/, "")
    .replace(/^thread-[af]:/i, "")
    .replace(/^msg-[af]:/i, "")
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
