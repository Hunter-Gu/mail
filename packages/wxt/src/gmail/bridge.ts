import type {
  GmailBridgeRequest,
  GmailBridgeResponse
} from "../protocol"
import { initializeGmailBridge, getSnapshot } from "./state"
import { listVisibleMessages, getMessage } from "./messages"
import { batchUpdateLabels, listLabels, updateLabels } from "./labels"

export { initializeGmailBridge } from "./state"

export async function handleGmailBridgeRequest(
  request: GmailBridgeRequest
): Promise<GmailBridgeResponse> {
  console.log("[bridge] Received request:", JSON.stringify(request))
  await initializeGmailBridge()

  switch (request.type) {
    case "snapshot:get":
      return getSnapshot()
    case "messages:list":
      return listVisibleMessages(request.limit, request.query, request.offset)
    case "message:get":
      return getMessage(request.messageId, request.metadataOnly ?? false)
    case "labels:list":
      return listLabels({
        filter: request.filter,
        query: request.query
      })
    case "labels:update":
      return updateLabels(
        request.messageId,
        request.addLabelIds,
        request.removeLabelIds
      )
    case "labels:batchUpdate":
      return batchUpdateLabels(
        request.messageIds,
        request.addLabelIds,
        request.removeLabelIds
      )
  }
}
