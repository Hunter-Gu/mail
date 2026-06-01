import { load, type InboxSDK } from "@inboxsdk/core"
import { Gmail } from "gmail-js"
import type { GmailClientError } from "agent"
import type { GmailSnapshot } from "../protocol"

export type BridgeState = {
  inboxSdk?: InboxSDK
  gmail?: Gmail
  inboxSdkError?: string
  gmailJsError?: string
}

export type CachedMessageData = {
  id: string
  threadId: string
  subject: string
  from: string
  to: string
  date: string
  body: string
  labels?: string[]
}

export type BridgeCallFn = (type: string, payload?: any) => Promise<any>
export const mainWorldBridge: { call?: BridgeCallFn } = {}

export const state: BridgeState = {}
export const activeThreadIds = new Set<string>()
export const messageViewsCache = new Map<string, CachedMessageData>()

export async function initializeGmailBridge(): Promise<GmailSnapshot> {
  await initializeInboxSdk()
  return await getSnapshot()
}

export async function initializeInboxSdk(): Promise<void> {
  if (state.inboxSdk || state.inboxSdkError) return

  try {
    const appId =
      import.meta.env.WXT_INBOXSDK_APP_ID ||
      import.meta.env.VITE_INBOXSDK_APP_ID ||
      "sdk_mail_agent"
    
    const loadPromise = load(2, appId, {
      appName: "Mail Agent"
    })

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("InboxSDK load timeout (15s)")), 15000)
    )

    state.inboxSdk = await Promise.race([loadPromise, timeoutPromise])

    console.log("[state] InboxSDK loaded, registering ThreadRowViewHandler...")
    state.inboxSdk.Lists.registerThreadRowViewHandler((threadRowView) => {
      const threadId = threadRowView.getThreadID()
      if (threadId) {
        console.log(`[state] Thread row loaded: ${threadId}`)
        activeThreadIds.add(threadId)
      }
      
      threadRowView.on("destroy", () => {
        if (threadId) {
          console.log(`[state] Thread row destroyed: ${threadId}`)
          activeThreadIds.delete(threadId)
        }
      })
    })

    console.log("[state] Registering registerMessageViewHandler...")
    state.inboxSdk.Conversations.registerMessageViewHandler((messageView) => {
      const messageId = messageView.getMessageID()
      
      const updateCache = () => {
        if (!messageView.isLoaded()) return
        
        try {
          const threadView = messageView.getThreadView()
          const threadId = threadView.getThreadID()
          const subject = threadView.getSubject()
          
          const sender = messageView.getSender()
          const fromStr = sender ? (sender.name ? `"${sender.name}" <${sender.emailAddress}>` : sender.emailAddress) : ""
          const recipients = messageView.getRecipients()
          const toStr = recipients.map(r => r.name ? `"${r.name}" <${r.emailAddress}>` : r.emailAddress).join(", ")
          const dateStr = messageView.getDateString()
          
          const bodyEl = messageView.getBodyElement()
          const bodyText = bodyEl ? bodyEl.innerText || bodyEl.textContent || "" : ""
          
          const cacheData = {
            id: messageId,
            threadId,
            subject,
            from: fromStr,
            to: toStr,
            date: dateStr,
            body: bodyText
          }
          
          messageViewsCache.set(messageId, cacheData)
          if (threadId) {
            messageViewsCache.set(threadId, cacheData)
          }
          console.log(`[state] Cached message view details for: ${messageId} (thread: ${threadId})`)
        } catch (err) {
          console.error("[state] Error caching message view:", err)
        }
      }

      if (messageView.isLoaded()) {
        updateCache()
      }

      messageView.on("load", () => {
        updateCache()
      })
    })
  } catch (error) {
    state.inboxSdkError = error instanceof Error ? error.message : String(error)
  }
}

export async function initializeGmailJs(): Promise<void> {
  // No-op in isolated world as we bridge to MAIN world gmail-main.content.ts
}

export async function getSnapshot(): Promise<GmailSnapshot> {
  const inboxSdk = state.inboxSdk
  const inboxError = state.inboxSdkError

  let visibleMessageCount: number | undefined
  let page: string | undefined
  let threadId: string | undefined
  let emailId: string | undefined
  let subject: string | undefined

  if (mainWorldBridge.call) {
    const snap = await mainWorldBridge.call("snapshot").catch(() => undefined)
    if (snap) {
      visibleMessageCount = snap.visibleMessageCount
      page = snap.page
      threadId = snap.threadId
      emailId = snap.emailId
      subject = snap.subject
    }
  }

  return {
    available: Boolean(visibleMessageCount !== undefined || inboxSdk),
    accountEmail: inboxSdk ? safeCall(() => inboxSdk.User.getEmailAddress()) : undefined,
    page,
    threadId,
    emailId,
    subject,
    visibleMessageCount,
    inboxSdkReady: Boolean(inboxSdk),
    gmailJsReady: Boolean(mainWorldBridge.call),
    error: inboxError || undefined
  }
}

export async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function waitForCondition<T>(
  fn: () => T | undefined | null,
  timeoutMs = 5000,
  intervalMs = 150
): Promise<T | null> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const res = fn()
    if (res) return res
    await delay(intervalMs)
  }
  return null
}

export function unsupported(error: string): GmailClientError {
  return { error }
}

export function safeCall<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch {
    return undefined
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
