import type { GmailEmailData } from "gmail-js"
import {
  delay,
  isObject,
  mainWorldBridge
} from "../state"

export async function getMainWorldEmailData(
  messageId: string
): Promise<GmailEmailData | undefined> {
  if (!mainWorldBridge.call) return undefined

  const data = await mainWorldBridge.call("email_data", { messageId }).catch(() => undefined)
  return hasThreadData(data) ? data : undefined
}

export async function waitForMainWorldEmailData(
  messageId: string,
  timeoutMs = 3500,
  intervalMs = 250
): Promise<GmailEmailData | undefined> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const data = await getMainWorldEmailData(messageId)
    if (data) return data
    await delay(intervalMs)
  }
  return undefined
}

export async function getMainWorldEmailDebug(messageId: string): Promise<unknown> {
  if (!mainWorldBridge.call) return { bridgeReady: false }
  return await mainWorldBridge.call("email_debug", { messageId }).catch((err) => ({
    error: err instanceof Error ? err.message : String(err)
  }))
}

function hasThreadData(value: unknown): value is GmailEmailData {
  return isObject(value) && isObject(value.threads)
}
