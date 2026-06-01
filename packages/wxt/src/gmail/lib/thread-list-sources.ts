import {
  activeThreadIds,
  delay,
  mainWorldBridge,
  stringValue
} from "../state"
import { getVisibleThreadIdsFromDom } from "./thread-fallbacks"
import type { ThreadListCacheResult } from "./types"

export async function waitForMainWorldThreadList(
  since?: number,
  timeoutMs = 1500,
  intervalMs = 200
): Promise<{ threadIds: string[]; reason: string }> {
  const start = Date.now()
  let lastResult = await getMainWorldThreadList(since)
  if (lastResult.threadIds.length > 0 || timeoutMs <= 0) return lastResult

  while (Date.now() - start < timeoutMs) {
    await delay(intervalMs)
    lastResult = await getMainWorldThreadList(since)
    if (lastResult.threadIds.length > 0) return lastResult
  }

  return lastResult
}

export async function pollThreadListSources(
  networkSince: number | undefined,
  timeoutMs: number,
  intervalMs: number
): Promise<string[] | null> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const network = await getMainWorldThreadList(networkSince)
    if (network.threadIds.length > 0) return network.threadIds

    let ids = Array.from(activeThreadIds)
    if (ids.length === 0) {
      ids = getVisibleThreadIdsFromDom()
    }
    if (ids.length > 0) return ids

    await delay(intervalMs)
  }

  return null
}

async function getMainWorldThreadList(
  since?: number
): Promise<{ threadIds: string[]; reason: string }> {
  if (!mainWorldBridge.call) {
    return {
      threadIds: [],
      reason: "MAIN world bridge is not initialized"
    }
  }

  const result = await mainWorldBridge.call("thread_list", {
    since,
    maxAgeMs: since ? 10000 : 45000
  }).catch((err) => ({
    error: err instanceof Error ? err.message : String(err)
  })) as ThreadListCacheResult | undefined

  const threadIds = Array.isArray(result?.threadIds)
    ? result.threadIds.map(stringValue).filter((id) => /^[0-9a-f]{16}$/i.test(id))
    : []

  if (threadIds.length > 0) {
    const source = result?.source || "Gmail thread-list response"
    const age = typeof result?.ageMs === "number" ? ` (${Math.round(result.ageMs)}ms old)` : ""
    return {
      threadIds,
      reason: `MAIN world intercepted ${source}${age}`
    }
  }

  return {
    threadIds: [],
    reason: formatThreadListMissReason(result)
  }
}

function formatThreadListMissReason(result?: ThreadListCacheResult): string {
  const base = result?.error || "MAIN world has no intercepted Gmail thread-list cache"
  const attempt = result?.recentAttempts?.[0]
  if (attempt) {
    return `${base}; latest matched ${attempt.source || "Gmail list response"} had ${attempt.responseLength ?? 0} chars and ${attempt.threadCount ?? 0} ids${attempt.error ? ` (${attempt.error})` : ""}`
  }
  const resource = result?.recentGmailResources?.[0]
  return resource ? `${base}; latest Gmail resource was ${resource}` : base
}
