import { handleGmailBridgeRequest, initializeGmailBridge } from "../src/gmail/bridge"
import { mainWorldBridge } from "../src/gmail/state"
import type { BackgroundRequest, GmailBridgeMessage } from "../src/protocol"

const pendingRequests = new Map<
  string,
  { resolve: (val: any) => void; reject: (err: any) => void }
>()

function sendToMainWorld(type: string, payload?: any): Promise<any> {
  const requestId = Math.random().toString(36).slice(2, 9)
  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject })
    
    // Set a timeout to prevent hanging if main world script is slow or not injected
    const timeout = setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId)
        console.warn(
          `[content] BRIDGE TIMEOUT for request "${type}".\n` +
          `-> If you recently added the "gmail-main" entrypoint, please RESTART your WXT dev server (wxt dev)!\n` +
          `-> Adding a new entrypoint requires WXT to compile the new script and regenerate the extension's manifest.`
        )
        reject(new Error(`Main world bridge timeout for request: ${type}`))
      }
    }, 6000)

    window.postMessage(
      {
        source: "mail-agent-isolated",
        requestId,
        type,
        payload
      },
      "*"
    )
  })
}

export default defineContentScript({
  matches: ["https://mail.google.com/*"],
  runAt: "document_start",
  main() {
    // Register the bridge call function in our shared state module
    mainWorldBridge.call = sendToMainWorld

    // Set up window listener to receive responses from MAIN world gmail-main.content.ts
    window.addEventListener("message", (event) => {
      if (event.data?.source !== "mail-agent-main") return
      
      const { requestId, payload, error } = event.data
      const pending = pendingRequests.get(requestId)
      
      if (pending) {
        pendingRequests.delete(requestId)
        if (error) {
          pending.reject(new Error(error))
        } else {
          pending.resolve(payload)
        }
      }
    })

    registerGmailBridge()

    void initializeGmailBridge().then((snapshot) => {
      const message: BackgroundRequest = {
        type: "gmail:ready",
        snapshot
      }
      return browser.runtime.sendMessage(message).catch(() => undefined)
    })
  }
})

function registerGmailBridge() {
  browser.runtime.onMessage.addListener(
    (message: GmailBridgeMessage, sender, sendResponse) => {
      if (message.type !== "gmail:request") return false
      
      handleGmailBridgeRequest(message.request)
        .then((response) => {
          sendResponse(response)
        })
        .catch((err) => {
          sendResponse({ error: String(err) })
        })
      
      return true // Keep message channel open for sendResponse
    }
  )
}
