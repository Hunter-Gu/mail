import type { SidebarState, ToolCallState } from "../protocol"

export function getReasoningSectionKey(messageId: string): string {
  return `${messageId}:reasoning`
}

export function getToolSectionKey(
  messageId: string,
  toolIndex: number
): string {
  return `${messageId}:tool:${toolIndex}`
}

export function getAutoOpenSectionKey(
  state: SidebarState
): string | undefined {
  const latestMessage = state.messages.at(-1)
  if (
    state.status !== "running" ||
    latestMessage?.role !== "assistant" ||
    latestMessage.content.trim()
  ) {
    return undefined
  }

  if (
    latestMessage.activeSection?.type === "reasoning" &&
    latestMessage.reasoning?.trim()
  ) {
    return getReasoningSectionKey(latestMessage.id)
  }

  if (latestMessage.activeSection?.type === "tool") {
    const toolIndex = latestMessage.activeSection.index
    const toolCall = latestMessage.toolCalls?.[toolIndex]
    if (toolCall?.status === "running") {
      return getToolSectionKey(latestMessage.id, toolIndex)
    }
  }

  const runningToolIndex = findLastRunningToolIndex(latestMessage.toolCalls)
  if (runningToolIndex >= 0) {
    return getToolSectionKey(latestMessage.id, runningToolIndex)
  }

  if (!latestMessage.toolCalls?.length && latestMessage.reasoning?.trim()) {
    return getReasoningSectionKey(latestMessage.id)
  }

  return undefined
}

function findLastRunningToolIndex(
  toolCalls: ToolCallState[] | undefined
): number {
  if (!toolCalls) {
    return -1
  }

  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    if (toolCalls[index]?.status === "running") {
      return index
    }
  }

  return -1
}
