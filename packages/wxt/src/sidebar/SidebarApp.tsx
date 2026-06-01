import { Tooltip } from "@base-ui/react/tooltip"
import { Mail, RotateCcw, Bug } from "lucide-react"
import {
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react"
import { GmailDebugger } from "./GmailDebugger"
import {
  getAutoOpenSectionKey,
  getReasoningSectionKey,
  getToolSectionKey
} from "./auto-collapse"

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton
} from "../ai-elements/conversation"
import {
  Message,
  MessageContent,
  MessageResponse
} from "../ai-elements/message"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger
} from "../components/ai-elements/reasoning"
import { Shimmer } from "../components/ai-elements/shimmer"
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput
} from "../components/ai-elements/tool"
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage
} from "../ai-elements/prompt-input"
import type {
  BackgroundEvent,
  BackgroundRequest,
  SidebarState,
  StateResponse,
  ToolCallState
} from "../protocol"

const initialState: SidebarState = {
  status: "ready",
  messages: [],
  gmail: {
    available: false,
    inboxSdkReady: false,
    gmailJsReady: false
  }
}

export function SidebarApp() {
  const [state, setState] = useState<SidebarState>(initialState)
  const [text, setText] = useState("")
  const [activeView, setActiveView] = useState<"chat" | "debug">("chat")
  const [sectionOpenOverrides, setSectionOpenOverrides] = useState<
    Record<string, boolean>
  >({})
  const autoOpenSectionKey = useMemo(
    () => getAutoOpenSectionKey(state),
    [state]
  )
  const previousAutoOpenSectionKey = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (previousAutoOpenSectionKey.current !== autoOpenSectionKey) {
      previousAutoOpenSectionKey.current = autoOpenSectionKey
      setSectionOpenOverrides({})
    }
  }, [autoOpenSectionKey])

  const isSectionOpen = useCallback(
    (sectionKey: string) =>
      sectionOpenOverrides[sectionKey] ?? sectionKey === autoOpenSectionKey,
    [autoOpenSectionKey, sectionOpenOverrides]
  )

  const setSectionOpen = useCallback((sectionKey: string, open: boolean) => {
    setSectionOpenOverrides((current) => {
      if (current[sectionKey] === open) return current
      return {
        ...current,
        [sectionKey]: open
      }
    })
  }, [])

  useEffect(() => {
    void sendBackground({ type: "state:get" }).then((response) => {
      setState(response.state)
    })

    const listener = (message: BackgroundEvent) => {
      if (message.type === "state:changed") {
        setState(message.state)
      }
    }
    browser.runtime.onMessage.addListener(listener)
    return () => browser.runtime.onMessage.removeListener(listener)
  }, [])

  const submit = (message: PromptInputMessage) => {
    const trimmed = message.text.trim()
    if (!trimmed || state.status === "running") return
    setText("")
    void sendBackground({ type: "chat:send", text: trimmed })
  }

  const reset = () => {
    void sendBackground({ type: "chat:reset" })
  }

  const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return
    }

    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  return (
    <section aria-label="Mail Agent" className="mail-agent-shell">
      <Tooltip.Provider closeDelay={100} delay={250}>
        <div className="mail-agent-panel">
          <header className="mail-agent-header">
            <div className="mail-agent-heading">
              <div className="mail-agent-mark" aria-hidden>
                <Mail size={16} strokeWidth={2.25} />
              </div>
              <div>
                <div className="mail-agent-title">Mail Agent</div>
                <div className="mail-agent-context">
                  {state.gmail.accountEmail || "Gmail"}
                </div>
              </div>
            </div>
            <div className="mail-agent-actions">
              <span
                aria-label={state.gmail.available ? "Connected" : "Connecting"}
                className={`mail-agent-status ${
                  state.gmail.available ? "is-connected" : ""
                }`}
                title={state.gmail.error || "Gmail bridge"}
              />
              <PromptInputButton
                aria-label="Reset conversation"
                className="mail-agent-reset"
                onClick={reset}
                tooltip="Reset"
                type="button"
              >
                <RotateCcw aria-hidden size={15} strokeWidth={2.25} />
              </PromptInputButton>
              <PromptInputButton
                aria-label="Toggle Debug Mode"
                className={`mail-agent-reset ${activeView === "debug" ? "is-active" : ""}`}
                onClick={() => setActiveView(activeView === "chat" ? "debug" : "chat")}
                tooltip={activeView === "chat" ? "Debug" : "Chat"}
                type="button"
              >
                <Bug aria-hidden size={15} strokeWidth={2.25} />
              </PromptInputButton>
            </div>
          </header>

          {activeView === "debug" ? (
            <GmailDebugger gmailSnapshot={state.gmail} />
          ) : (
            <>
              <div className="mail-agent-thread-meta">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", gap: "8px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: 1 }}>
                    <span>{state.gmail.page || "mail"}</span>
                    {state.gmail.subject && <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{state.gmail.subject}</strong>}
                  </div>
                  {state.gmail.lastMessageStep && (
                    <span className="mail-agent-step-badge" title="Resolved method for the last message">
                      {state.gmail.lastMessageStep}
                    </span>
                  )}
                </div>
              </div>

              <Conversation
                aria-label="Conversation"
                className="mail-agent-conversation"
              >
                <ConversationContent>
                  {state.messages.map((message, messageIndex) => {
                    const isLatestStreamingAssistant =
                      message.role === "assistant" &&
                      messageIndex === state.messages.length - 1 &&
                      state.status === "running"
                    const hasTools =
                      message.toolCalls !== undefined &&
                      message.toolCalls.length > 0
                    const reasoningSectionKey = getReasoningSectionKey(
                      message.id
                    )

                    return (
                      <Message from={message.role} key={message.id}>
                        <div className="mail-agent-message-role">
                          {message.role === "user" ? "You" : "Agent"}
                        </div>
                        <MessageContent>
                          {message.reasoning && (
                            <Reasoning
                              isStreaming={
                                isLatestStreamingAssistant &&
                                autoOpenSectionKey === reasoningSectionKey
                              }
                              onOpenChange={(open) =>
                                setSectionOpen(reasoningSectionKey, open)
                              }
                              open={isSectionOpen(reasoningSectionKey)}
                            >
                              <ReasoningTrigger />
                              <ReasoningContent>
                                {message.reasoning}
                              </ReasoningContent>
                            </Reasoning>
                          )}

                          {message.toolCalls?.map((tool, index) => {
                            const toolSectionKey = getToolSectionKey(
                              message.id,
                              index
                            )

                            return (
                              <Tool
                                key={`${tool.name}-${index}`}
                                onOpenChange={(open) =>
                                  setSectionOpen(toolSectionKey, open)
                                }
                                open={isSectionOpen(toolSectionKey)}
                              >
                                <ToolHeader
                                  state={toToolState(tool.status)}
                                  title={tool.name}
                                  toolName={tool.name}
                                  type="dynamic-tool"
                                />
                                <ToolContent>
                                  <ToolInput input={tool.args} />
                                  {tool.result !== undefined && (
                                    <ToolOutput
                                      errorText={
                                        tool.status === "error"
                                          ? formatToolResult(tool.result)
                                          : undefined
                                      }
                                      output={
                                        tool.status === "error"
                                          ? undefined
                                          : formatToolResult(tool.result)
                                      }
                                    />
                                  )}
                                </ToolContent>
                              </Tool>
                            )
                          })}

                          {message.content ? (
                            <MessageResponse>{message.content}</MessageResponse>
                          ) : (
                            !message.reasoning &&
                            !hasTools &&
                            isLatestStreamingAssistant && (
                              <MessageResponse>
                                <Shimmer duration={1}>Working...</Shimmer>
                              </MessageResponse>
                            )
                          )}
                        </MessageContent>
                      </Message>
                    )
                  })}
                </ConversationContent>
                <ConversationScrollButton />
              </Conversation>

              {state.status === "paused" && (
                <div className="mail-agent-continue-prompt">
                  <div className="mail-agent-continue-text">
                    The agent is requesting permission to continue.
                  </div>
                  <div className="mail-agent-continue-actions">
                    <button
                      className="mail-agent-continue-btn approve"
                      onClick={() => void sendBackground({ type: "chat:continue", approve: true })}
                    >
                      Approve & Continue
                    </button>
                    <button
                      className="mail-agent-continue-btn reject"
                      onClick={() => void sendBackground({ type: "chat:continue", approve: false })}
                    >
                      Stop
                    </button>
                  </div>
                </div>
              )}

              {state.error && <div className="mail-agent-error">{state.error}</div>}

              <PromptInput className="mail-agent-composer" onSubmit={submit}>
                <PromptInputTextarea
                  disabled={state.status === "running" || state.status === "paused"}
                  onChange={(event) => setText(event.currentTarget.value)}
                  onKeyDown={submitOnEnter}
                  placeholder="Message Mail Agent"
                  rows={2}
                  value={text}
                />
                <PromptInputFooter>
                  <PromptInputTools>
                    <span className="mail-agent-context-chip">
                      {state.gmail.available ? "Gmail ready" : "Connecting"}
                    </span>
                  </PromptInputTools>
                  <PromptInputSubmit
                    disabled={!text.trim() || state.status === "running" || state.status === "paused"}
                    status={state.status === "running" ? "streaming" : "ready"}
                  />
                </PromptInputFooter>
              </PromptInput>
            </>
          )}
        </div>
      </Tooltip.Provider>
    </section>
  )
}

async function sendBackground(request: BackgroundRequest): Promise<StateResponse> {
  return browser.runtime.sendMessage(request)
}

function toToolState(
  status: ToolCallState["status"]
): "input-available" | "output-available" | "output-error" {
  if (status === "running") return "input-available"
  if (status === "error") return "output-error"
  return "output-available"
}

function formatToolResult(result: unknown): string {
  if (result === null || result === undefined) return ""
  if (typeof result === "object") {
    return JSON.stringify(result, null, 2)
  }
  try {
    const parsed = JSON.parse(String(result))
    return JSON.stringify(parsed, null, 2)
  } catch {
    return String(result)
  }
}
