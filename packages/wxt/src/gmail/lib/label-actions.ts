import { delay } from "../state"
import { isVisible } from "./dom"

export const MARK_READ_KEYWORDS = ["mark as read", "mark read", "标记为已读"]
export const MARK_UNREAD_KEYWORDS = ["mark as unread", "mark unread", "标记为未读"]

export async function waitForGmailActionButton(
  requiredKeywords: string[],
  excludedKeywords: string[] = [],
  timeoutMs = 1800
): Promise<HTMLElement | null> {
  const start = Date.now()
  let button = findGmailActionButton(requiredKeywords, excludedKeywords)
  while (!button && Date.now() - start < timeoutMs) {
    await delay(150)
    button = findGmailActionButton(requiredKeywords, excludedKeywords)
  }
  return button
}

export function collectVisibleActionCandidateLabels(): string[] {
  return Array.from(
    new Set(
      collectActionCandidates()
        .map(getActionCandidateLabel)
        .filter(Boolean)
    )
  ).slice(0, 30)
}

function findGmailActionButton(
  requiredKeywords: string[],
  excludedKeywords: string[] = []
): HTMLElement | null {
  const candidates = collectActionCandidates()
    .sort((a, b) => actionCandidateScore(b) - actionCandidateScore(a))
  return candidates.find((candidate) => {
    const label = getActionCandidateLabel(candidate)
    return requiredKeywords.some((keyword) => label.includes(keyword.toLowerCase())) &&
      !excludedKeywords.some((keyword) => label.includes(keyword.toLowerCase()))
  }) || null
}

function collectActionCandidates(): HTMLElement[] {
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
      isGmailActionCandidate(candidate) &&
      candidate.getAttribute("aria-disabled") !== "true" &&
      candidate.getAttribute("disabled") == null &&
      !candidate.classList.contains("T-I-JE")
    )

  return Array.from(new Set(roots))
}

function getActionCandidateLabel(el: HTMLElement): string {
  return [
    el.getAttribute("aria-label"),
    el.getAttribute("data-tooltip"),
    el.getAttribute("title"),
    el.textContent
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase()
}

function isGmailActionCandidate(el: HTMLElement): boolean {
  if (isNavigationCandidate(el)) return false
  if (el.closest('[role="toolbar"], [gh="mtb"], [gh="tm"], .G-tF')) return true
  return Boolean(el.closest("main, [role='main']"))
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

function actionCandidateScore(el: HTMLElement): number {
  let score = 0
  if (el.closest('[role="toolbar"], [gh="mtb"]')) score += 6
  if (el.closest('main, [role="main"]')) score += 2
  if (el.closest('nav, [role="navigation"]')) score -= 6
  return score
}
