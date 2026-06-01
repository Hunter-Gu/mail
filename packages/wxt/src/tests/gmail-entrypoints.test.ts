import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const readGmailMessageFiles = () => ({
  api: readFileSync(resolve(packageRoot, "src/gmail/messages.ts"), "utf8"),
  fallbacks: readFileSync(resolve(packageRoot, "src/gmail/lib/thread-fallbacks.ts"), "utf8"),
  pagination: readFileSync(resolve(packageRoot, "src/gmail/lib/pagination.ts"), "utf8"),
  sources: readFileSync(resolve(packageRoot, "src/gmail/lib/thread-list-sources.ts"), "utf8"),
  messageSources: readFileSync(resolve(packageRoot, "src/gmail/lib/message-sources.ts"), "utf8"),
  routes: readFileSync(resolve(packageRoot, "src/gmail/lib/routes.ts"), "utf8")
})
const readGmailLabelFiles = () => ({
  api: readFileSync(resolve(packageRoot, "src/gmail/labels.ts"), "utf8"),
  actions: readFileSync(resolve(packageRoot, "src/gmail/lib/label-actions.ts"), "utf8"),
  detailActions: readFileSync(resolve(packageRoot, "src/gmail/lib/thread-detail-label-actions.ts"), "utf8"),
  sources: readFileSync(resolve(packageRoot, "src/gmail/lib/label-sources.ts"), "utf8")
})

describe("Gmail extension entrypoints", () => {
  it("registers the gmail-js bridge as a MAIN world content script", () => {
    const mainWorldEntrypoint = resolve(
      packageRoot,
      "entrypoints/gmail-main.content.ts"
    )
    const source = readFileSync(mainWorldEntrypoint, "utf8")

    expect(existsSync(mainWorldEntrypoint)).toBe(true)
    expect(existsSync(resolve(packageRoot, "entrypoints/gmail-main.ts"))).toBe(
      false
    )
    expect(source).toContain('world: "MAIN"')
    expect(source).not.toContain("gmail.get.email_subject")
    expect(source).not.toContain("gmail.get.visible_emails")
    expect(source).not.toContain("gmail.get.thread_id")
    expect(source).not.toContain("gmail.get.email_id")
    expect(source).not.toContain("gmail.get.labels")
    expect(source).not.toContain("gmail.get.email_data")
    expect(source).toContain("gmail.cache.emailLegacyIdCache")
    expect(source).toContain("gmail.new.get.email_data")
    expect(source).toContain("gmail.new.get.thread_data")
    expect(source).toContain('case "email_debug"')
    expect(source).toContain('case "thread_list"')
    expect(source).toContain("installThreadListInterceptors")
    expect(source).toContain("XMLHttpRequest.prototype.open")
    expect(source).toContain("i\\/bv")
    expect(source).toContain("threadDetailVisible")
    expect(source).toContain("hasVisibleThreadDetail")
    expect(source).toContain('case "labels_omni"')
    expect(source).toContain('"view", "omni"')
    expect(source).toContain("GM_ID_KEY")
    expect(source).not.toContain('case "labels_private"')
    expect(source).not.toContain("/sync/u/${accountIndex}/i/s")
  })

  it("tries Gmail view=omni labels before the DOM fallback", () => {
    const labels = readGmailLabelFiles()

    expect(labels.sources).toContain('mainWorldBridge.call("labels_omni")')
    expect(labels.api).toContain("step = omniLabels")
    expect(labels.api).toContain('"gmail view=omni"')
    expect(labels.api).toContain('"dom fallback"')
    expect(labels.api).toContain("reason = omniLabels")
    expect(labels.api.indexOf("getOmniLabelsFromMainWorld")).toBeLessThan(
      labels.api.indexOf("getCustomLabelsFromDom")
    )
  })

  it("uses InboxSDK's thread route parameter casing", () => {
    const messages = readGmailMessageFiles()
    const labels = readGmailLabelFiles()

    expect(messages.api).toContain("threadID: messageId")
    expect(messages.api).toContain('"inboxsdk cache"')
    expect(messages.api).toContain('"inboxsdk cache after navigation"')
    expect(messages.api).toContain("waitForMainWorldEmailData")
    expect(messages.api).toContain("gmailJsDebug")
    expect(messages.api).toContain("sourceTrace")
    expect(messages.api).toContain("navigationStep")
    expect(messages.api).toContain("reason:")
    expect(messages.api).toContain("getCurrentSearchQuery")
    expect(messages.routes).toContain("getCurrentInboxSdkSearchQuery")
    expect(messages.messageSources).toContain('mainWorldBridge.call("email_debug"')
    expect(messages.api).toContain('"gmail-js network"')
    expect(labels.api).not.toContain("threadID: messageId")
    expect(labels.api).not.toContain("ensureThreadOpenForLabelUpdate")
    expect(labels.api).not.toContain("updateLabelsFromThreadDetail")
    expect(labels.api).toContain("batchUpdateLabels")
    expect(labels.api).toContain("applyBulkListLabelActions")
    expect(labels.api).toContain('"gmail list bulk label update"')
    expect(labels.api).toContain("labelActionTrace")
    expect(labels.api).not.toContain("getCurrentThreadRouteLabelHints")
    expect(labels.api).not.toContain("isCurrentThreadDetailVisible")
    expect(labels.api).not.toContain("unsupportedLabelChangeResponse")
    expect(labels.api).not.toContain("completedAddLabelIds")
    expect(labels.api).not.toContain("Supported changes were attempted first")
    expect(labels.api).toContain("showGmailAgentNotice")
    expect(labels.api).toContain("nonRetryable")
    expect(labels.api).toContain("userNotified")
    expect(labels.actions).toContain("MARK_READ_KEYWORDS")
    expect(labels.actions).toContain("waitForGmailActionButton")
    expect(labels.actions).toContain("MARK_UNREAD_KEYWORDS")
    expect(labels.actions).toContain("collectVisibleActionCandidateLabels")
    expect(labels.actions).not.toContain("applyLabelDomActions")
    expect(labels.actions).not.toContain("findStarToggleButtons")
    expect(labels.actions).not.toContain("findLabelMenuApplyButton")
    expect(labels.detailActions).toContain("updateLabelsFromThreadDetail")
    expect(labels.detailActions).toContain("ensureThreadOpenForDetailLabelUpdate")
    expect(labels.detailActions).toContain("applyThreadDetailLabelDomActions")
    expect(labels.detailActions).toContain("threadID: messageId")
    expect(labels.detailActions).toContain("openThreadFromDomFallback")
  })

  it("keeps messages:list on list routes before scraping rows", () => {
    const messages = readGmailMessageFiles()

    expect(messages.api).toContain("isThreadDetailPage")
    expect(messages.api).toContain("NativeRouteIDs.INBOX")
    expect(messages.api).toContain('"thread detail guard"')
    expect(messages.api).toContain("getVisibleThreadRows")
    expect(messages.fallbacks).toContain('document.querySelectorAll<HTMLElement>(')
    expect(messages.fallbacks).not.toContain('document.querySelectorAll("[data-thread-id]")')
    expect(messages.fallbacks).not.toContain('document.querySelectorAll("[data-legacy-thread-id]")')
  })

  it("prefers intercepted Gmail thread-list responses for messages:list", () => {
    const messages = readGmailMessageFiles()
    const combinedMessages = [
      messages.api,
      messages.fallbacks,
      messages.pagination,
      messages.sources
    ].join("\n")

    expect(messages.sources).toContain('mainWorldBridge.call("thread_list"')
    expect(messages.api).toContain('"gmail network thread-list cache"')
    expect(combinedMessages).toContain("waitForMainWorldThreadList")
    expect(combinedMessages).toContain("pollThreadListSources")
    expect(messages.api.indexOf('"gmail network thread-list cache"')).toBeLessThan(
      messages.api.indexOf('"inboxsdk tracked threads"')
    )
    expect(messages.api.indexOf('"gmail-js visible_emails"')).toBeLessThan(
      messages.api.indexOf('"dom visible rows"')
    )
  })

  it("paginates messages:list with InboxSDK route pages before Gmail button fallback", () => {
    const messages = readGmailMessageFiles()
    const main = readFileSync(
      resolve(packageRoot, "entrypoints/gmail-main.content.ts"),
      "utf8"
    )

    expect(messages.api).toContain("collectAdditionalThreadPages")
    expect(messages.api).toContain("resetToFirstResultPage")
    expect(messages.pagination).toContain("navigateToInboxSdkListPage")
    expect(messages.pagination).toContain("previousRange: GmailPageRange | null")
    expect(messages.pagination).toContain("getCurrentInboxSdkListPageNumber() + 1")
    expect(messages.pagination).toContain("buildInboxSdkPageParams")
    expect(messages.pagination).toContain("getPageNumberFromRange")
    expect(messages.pagination).toContain('"inboxsdk route page navigation"')
    expect(messages.pagination).toContain("findNewerPageButton")
    expect(messages.pagination).toContain('"gmail first-page reset"')
    expect(messages.pagination).toContain('"gmail newer page click"')
    expect(messages.api).toContain("requestedOffset")
    expect(messages.api).toContain("targetEndIndex")
    expect(messages.api).toContain("messages.slice(requestedOffset, targetEndIndex)")
    expect(messages.api).toContain("getCurrentGmailPageRange")
    expect(messages.pagination).toContain("getPaginationTurnBudget")
    expect(messages.api).toContain("needsMorePagination")
    expect(messages.pagination).toContain("waitForGmailPageRangeAdvance")
    expect(messages.pagination).toContain('waitForGmailPageRangeAdvance(previousRange, "older"')
    expect(messages.pagination).toContain('waitForGmailPageRangeAdvance(previousRange, "newer"')
    expect(messages.pagination).toContain("isOlderPaginationButton")
    expect(messages.pagination).toContain("isNewerPaginationButton")
    expect(messages.pagination).toContain('"gmail pagination plan"')
    expect(messages.pagination).toContain('"gmail pagination range"')
    expect(messages.pagination).toContain("findOlderPageButton")
    expect(messages.pagination).not.toContain(".amD[role='button']")
    expect(messages.pagination).toContain("clickGmailButton")
    expect(messages.pagination).toContain('"gmail older pagination"')
    expect(messages.api).toContain("paginationStep")
    expect(messages.api).toContain("paginationReason")
    expect(messages.pagination).toContain("waitForNewVisiblePageIds")
    expect(main).toContain("threadListCache.length - 25")
    expect(main).not.toContain('fetchTextWithTimeout(`${window.location.origin}/sync')
  })

  it("exposes a Gmail list bulk label update path for read, unread, star, important, and move-to labels", () => {
    const protocol = readFileSync(resolve(packageRoot, "src/protocol.ts"), "utf8")
    const bridge = readFileSync(resolve(packageRoot, "src/gmail/bridge.ts"), "utf8")
    const background = readFileSync(resolve(packageRoot, "src/background/state.ts"), "utf8")
    const labels = readFileSync(resolve(packageRoot, "src/gmail/labels.ts"), "utf8")
    const bulkActions = readFileSync(resolve(packageRoot, "src/gmail/lib/bulk-actions.ts"), "utf8")
    const debuggerUi = readFileSync(resolve(packageRoot, "src/sidebar/GmailDebugger.tsx"), "utf8")

    expect(protocol).toContain('"labels:batchUpdate"')
    expect(bridge).toContain("batchUpdateLabels")
    expect(background).not.toContain("updateLabelsBatch")
    expect(debuggerUi).toContain('<option value="labels:batchUpdate">labels:batchUpdate</option>')
    expect(debuggerUi).toContain('type: "labels:batchUpdate"')
    expect(debuggerUi).toContain("parseCommaOrLineList(messageIds)")
    expect(debuggerUi).not.toContain('setAddLabelIds("UNREAD")')
    expect(debuggerUi).not.toContain('setRemoveLabelIds("INBOX")')
    expect(debuggerUi).toContain("Work (Move to)")
    expect(bulkActions).toContain("selectVisibleThreadRows")
    expect(bulkActions).toContain("findThreadRowCheckbox")
    expect(bulkActions).toContain("MARK_READ_KEYWORDS")
    expect(bulkActions).toContain("MARK_UNREAD_KEYWORDS")
    expect(bulkActions).toContain("normalizeRequestedLabelChanges")
    expect(bulkActions).toContain("Mapped add")
    expect(bulkActions).toContain("clickMoreMenuAction")
    expect(bulkActions).toContain("waitForRowsStarState")
    expect(bulkActions).toContain("did not visibly update selected rows")
    expect(bulkActions).toContain("findRowStarControl")
    expect(bulkActions).toContain("Falling back to visible row star controls")
    expect(bulkActions).toContain("show more messages")
    expect(bulkActions).toContain("add star")
    expect(bulkActions).toContain("mark important")
    expect(bulkActions).toContain("clickMoveToLabel")
    expect(bulkActions).toContain("move to")
    expect(bulkActions).toContain("unsupported list label actions")
    expect(bulkActions).not.toContain("applyLabelsMenuChanges")
    expect(bulkActions).not.toContain("findLabelMenuApplyButton")
    expect(labels).toContain('"gmail list bulk label update"')
    expect(labels).not.toContain("gmail thread detail label update")
    expect(labels).not.toContain("updateLabelsFromThreadDetail")
    expect(bulkActions).not.toContain("selected_emails_data")
  })

  it("loads InboxSDK's background injector", () => {
    const backgroundEntrypoint = readFileSync(
      resolve(packageRoot, "entrypoints/background.ts"),
      "utf8"
    )

    expect(backgroundEntrypoint).toContain('import "@inboxsdk/core/background"')
  })

  it("exposes InboxSDK's page-world script at the injected path", () => {
    const config = readFileSync(resolve(packageRoot, "wxt.config.ts"), "utf8")

    expect(config).toContain('resources: ["pageWorld.js"]')
  })
})
