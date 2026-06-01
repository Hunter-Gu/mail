import "@inboxsdk/core/background"
import {
  getState,
  handleContinue,
  publishState,
  resetChat,
  sendUserMessage,
  updateGmailSnapshot,
  handleDebugGmailRequest
} from "../src/background/state"
import type { BackgroundRequest } from "../src/protocol"

export default defineBackground(() => {
  configureNativeSidePanel()

  browser.runtime.onInstalled.addListener(() => {
    void publishState()
  })

  browser.tabs.onActivated.addListener(({ tabId }) => {
    void updateSidePanelForTab(tabId)
  })

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.status === "complete") {
      void updateSidePanelForTab(tabId)
    }
  })

  browser.runtime.onMessage.addListener(
    (request: BackgroundRequest, sender, sendResponse) => {
      switch (request.type) {
        case "state:get":
          sendResponse({ state: getState() })
          return false
        case "chat:send":
          sendUserMessage(request.text, sender.tab?.id).then(
            (state) => {
              sendResponse({ state })
            }
          ).catch(err => {
            sendResponse({ error: String(err) })
          })
          return true
        case "chat:reset":
          resetChat().then((state) => {
            sendResponse({ state })
          })
          return true
        case "chat:continue":
          handleContinue(request.approve)
          sendResponse({ state: getState() })
          return false
        case "gmail:ready":
          updateGmailSnapshot(request.snapshot).then((state) => {
            sendResponse({ state })
          })
          return true
        case "gmail:debug_request":
          handleDebugGmailRequest(request.request).then((response) => {
            sendResponse(response)
          }).catch((err) => {
            sendResponse({ error: String(err) })
          })
          return true
        case "state:changed" as any:
          return false
        default:
          return false
      }
    }
  )
})




type ChromeSidePanelApi = {
  setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>
  setOptions(options: {
    tabId: number
    path?: string
    enabled: boolean
  }): Promise<void>
}

type ChromeWithSidePanel = {
  sidePanel?: ChromeSidePanelApi
}

function configureNativeSidePanel() {
  const sidePanel = getSidePanel()
  void sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => undefined)
}

async function updateSidePanelForTab(tabId: number) {
  const sidePanel = getSidePanel()
  if (!sidePanel) return

  const tab = await browser.tabs.get(tabId).catch(() => undefined)
  const enabled = Boolean(tab?.url?.startsWith("https://mail.google.com/"))

  await sidePanel
    .setOptions({
      tabId,
      path: "sidepanel.html",
      enabled
    })
    .catch(() => undefined)
}

function getSidePanel(): ChromeSidePanelApi | undefined {
  return (globalThis as typeof globalThis & { chrome?: ChromeWithSidePanel })
    .chrome?.sidePanel
}
