import type {
  GmailClientError,
  GmailLabel,
  GmailListLabelsResponse,
  GmailMessage
} from "agent"
import type { GmailBatchUpdateLabelsResponse } from "../protocol"
import { mainWorldBridge, state, unsupported } from "./state"
import {
  collectVisibleLabelIds,
  getVisibleLabelIds,
  labelIdToName,
  mergeLabels,
  normalizeLabelId,
  systemLabels
} from "./lib/label-model"
import {
  getOmniLabelsFromMainWorld,
  getCustomLabelsFromDom
} from "./lib/label-sources"
import { showGmailAgentNotice } from "./lib/notification"
import { applyBulkListLabelActions } from "./lib/bulk-actions"

export {
  collectVisibleLabelIds,
  getVisibleLabelIds,
  labelIdToName,
  mergeLabels,
  normalizeLabelId,
  systemLabels
} from "./lib/label-model"
export { getCustomLabelsFromDom } from "./lib/label-sources"

export async function listLabels(
  args?: { filter?: "all" | "system" | "user"; query?: string }
): Promise<GmailListLabelsResponse & { logs?: string[]; step?: string; reason?: string }> {
  const logs: string[] = []
  const log = (msg: string) => {
    const formatted = `[labels:list] ${msg}`
    console.log(formatted)
    logs.push(formatted)
  }

  log(`listLabels called with args: ${JSON.stringify(args || {})}`)

  const systemIds = new Set(systemLabels.map((label) => label.id.toUpperCase()))
  const systemNames = new Set(systemLabels.map((label) => label.name.toUpperCase()))

  const omniProbe = await getOmniLabelsFromMainWorld(log)
  const omniLabels = omniProbe.labels
  const step = omniLabels
    ? "gmail view=omni"
    : "dom fallback"
  const reason = omniLabels
    ? `Gmail view=omni returned custom label names${omniProbe.source ? ` from ${omniProbe.source}` : ""}`
    : `Gmail view=omni did not return custom label names${omniProbe.failureReason ? `: ${omniProbe.failureReason}` : ""}; scraped Gmail sidebar labels`
  log(`Using labels step: ${step}`)

  const rawCustomLabels = omniLabels
    ? []
    : await getCustomLabelsFromDom(log)

  const customLabels = rawCustomLabels
    .filter((name) => !systemIds.has(name.toUpperCase()) && !systemNames.has(name.toUpperCase()))
    .map((name) => ({
      id: name,
      name,
      type: "user" as const
    }))

  log(`Custom labels mapped: ${JSON.stringify(customLabels)}`)

  log("Collecting visible labels from current view...")
  const visibleLabelIds = collectVisibleLabelIds()
  log(`Visible labels collected from gmail-js: ${JSON.stringify(visibleLabelIds)}`)

  const visibleLabels = visibleLabelIds.map((id) => {
    const normalized = normalizeLabelId(id)
    const isSystem = systemLabels.some((label) => label.id === normalized)
    return {
      id: normalized,
      name: labelIdToName(normalized),
      type: isSystem ? ("system" as const) : ("user" as const)
    }
  })

  log(`Visible labels resolved: ${JSON.stringify(visibleLabels)}`)

  let allLabels: GmailLabel[] = mergeLabels([
    ...systemLabels,
    ...(omniLabels || []),
    ...customLabels,
    ...visibleLabels
  ])
  log(`Total labels combined (before filter): ${allLabels.length}`)

  const filterType = args?.filter || "all"
  if (filterType === "system") {
    log("Filtering for 'system' labels only.")
    allLabels = allLabels.filter((label) => label.type === "system")
  } else if (filterType === "user") {
    log("Filtering for 'user' labels only.")
    allLabels = allLabels.filter((label) => label.type === "user")
  }

  const filterQuery = args?.query?.trim().toLowerCase()
  if (filterQuery) {
    log(`Filtering labels matching query: "${filterQuery}"`)
    allLabels = allLabels.filter(
      (label) => label.id.toLowerCase().includes(filterQuery) ||
        label.name.toLowerCase().includes(filterQuery)
    )
  }

  log(`Returning ${allLabels.length} labels after filtering.`)
  return {
    labels: allLabels,
    step,
    reason,
    logs
  }
}

export async function updateLabels(
  messageId: string,
  addLabelIds: string[] = [],
  removeLabelIds: string[] = []
): Promise<GmailMessage | GmailClientError> {
  const result = await batchUpdateLabels([messageId], addLabelIds, removeLabelIds)
  if (isGmailError(result)) return result

  const message = result.messages?.[0] ?? {
    id: messageId,
    threadId: messageId
  }
  return {
    ...message,
    step: result.step,
    reason: result.reason,
    batchUpdate: result
  } as any
}

export async function batchUpdateLabels(
  messageIds: string[],
  addLabelIds: string[] = [],
  removeLabelIds: string[] = []
): Promise<GmailBatchUpdateLabelsResponse | GmailClientError> {
  const logs: string[] = []
  const log = (msg: string) => {
    const formatted = `[labels:batchUpdate] ${msg}`
    console.log(formatted)
    logs.push(formatted)
  }

  if (!state.inboxSdk && !mainWorldBridge.call) {
    return unsupported("Gmail interfaces (InboxSDK/MAIN world bridge) are not ready.")
  }

  const ids = [...new Set(messageIds.map((id) => normalizeDomGmailId(id.trim())).filter(Boolean))]
  if (ids.length === 0) {
    return { error: "No Gmail message IDs were provided for batch label update." }
  }

  log(`batchUpdateLabels called for ${ids.length} messages; add=${JSON.stringify(addLabelIds)}, remove=${JSON.stringify(removeLabelIds)}`)

  const actionReport = await applyBulkListLabelActions(ids, addLabelIds, removeLabelIds)
  logs.push(...actionReport.logs)

  if (actionReport.success) {
    return {
      updatedIds: actionReport.updatedIds,
      messages: actionReport.messages,
      failed: actionReport.failed,
      step: "gmail list bulk label update",
      reason: `Selected ${actionReport.selectedIds.length} visible Gmail row(s) and clicked Gmail's native bulk toolbar action(s): ${actionReport.clicked.join(", ")}`,
      logs,
      labelActionTrace: actionReport
    } as any
  }

  const reason = `Gmail bulk UI action did not complete: ${actionReport.missing.join("; ") || "unknown failure"}`
  showGmailAgentNotice(
    "Mail Agent could not update Gmail labels in bulk",
    `${reason}. This request will not be retried automatically.`
  )
  return {
    error: `${reason}. A notice was shown to the user; do not retry this request in WXT.`,
    nonRetryable: true,
    userNotified: true,
    step: "gmail list bulk label update failed",
    reason,
    logs,
    labelActionTrace: actionReport
  } as any
}

function normalizeDomGmailId(value: string | undefined): string {
  return (value || "")
    .replace(/^#/, "")
    .replace(/^thread-[af]:/i, "")
    .replace(/^msg-[af]:/i, "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isGmailError(value: unknown): value is GmailClientError {
  return isRecord(value) && typeof value.error === "string"
}
