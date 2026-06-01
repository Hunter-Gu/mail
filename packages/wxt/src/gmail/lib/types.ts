export type VisibleEmail = {
  id?: unknown
  thread_id?: unknown
  threadId?: unknown
  labels?: unknown
}

export type SourceTrace = {
  step: string
  count: number
  reason: string
}

export type ThreadListCacheResult = {
  threadIds?: unknown
  complete?: boolean
  source?: string
  ageMs?: number
  cacheSize?: number
  error?: string
  recentAttempts?: Array<{
    source?: string
    responseLength?: number
    threadCount?: number
    error?: string
  }>
  recentGmailResources?: string[]
}

export type GmailPageRange = {
  raw: string
  start: number
  end: number
  pageSize: number
  total?: number
}

export type GmailPaginationDirection = "older" | "newer"
