import { useState } from "react"
import { Play, Copy, Check, Info, RefreshCw } from "lucide-react"
import type { GmailSnapshot } from "../protocol"

interface GmailDebuggerProps {
  gmailSnapshot: GmailSnapshot
}

function parseCommaOrLineList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

type GmailApiType =
  | "snapshot:get"
  | "messages:list"
  | "message:get"
  | "labels:list"
  | "labels:update"
  | "labels:batchUpdate"

export function GmailDebugger({ gmailSnapshot }: GmailDebuggerProps) {
  const [api, setApi] = useState<GmailApiType>("snapshot:get")
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState<unknown | null>(null)
  const [copied, setCopied] = useState(false)

  // Input states
  const [query, setQuery] = useState("")
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(10)
  const [messageId, setMessageId] = useState("")
  const [messageIds, setMessageIds] = useState("")
  const [metadataOnly, setMetadataOnly] = useState(false)
  const [addLabelIds, setAddLabelIds] = useState("")
  const [removeLabelIds, setRemoveLabelIds] = useState("")
  const [labelFilter, setLabelFilter] = useState<"all" | "system" | "user">("all")
  const [labelQuery, setLabelQuery] = useState("")

  const executeApi = async () => {
    setLoading(true)
    setResponse(null)
    setCopied(false)

    let request: any = { type: api }

    switch (api) {
      case "messages:list":
        request = {
          type: "messages:list",
          query: query.trim() || undefined,
          offset: Number(offset),
          limit: Number(limit)
        }
        break
      case "message:get":
        request = {
          type: "message:get",
          messageId: messageId.trim(),
          metadataOnly
        }
        break
      case "labels:list":
        request = {
          type: "labels:list",
          filter: labelFilter,
          query: labelQuery.trim() || undefined
        }
        break
      case "labels:update":
        request = {
          type: "labels:update",
          messageId: messageId.trim(),
          addLabelIds: addLabelIds
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          removeLabelIds: removeLabelIds
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        }
        break
      case "labels:batchUpdate":
        request = {
          type: "labels:batchUpdate",
          messageIds: parseCommaOrLineList(messageIds),
          addLabelIds: parseCommaOrLineList(addLabelIds),
          removeLabelIds: parseCommaOrLineList(removeLabelIds)
        }
        break
    }

    try {
      const res = await browser.runtime.sendMessage({
        type: "gmail:debug_request",
        request
      })
      setResponse(res)
    } catch (err) {
      setResponse({
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = () => {
    if (!response) return
    const text = JSON.stringify(response, null, 2)
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const useCurrentMessageId = () => {
    const id = gmailSnapshot.threadId || gmailSnapshot.emailId
    if (id) {
      setMessageId(id)
    }
  }

  return (
    <div className="mail-agent-debugger">
      <div className="mail-agent-debugger-header">
        <h2 className="mail-agent-debugger-title">Gmail API Tester</h2>
        <p className="mail-agent-debugger-subtitle">
          Test internal bridge APIs directly in the active tab context.
        </p>
      </div>

      <div className="mail-agent-debugger-form">
        <div className="mail-agent-debugger-field">
          <label className="mail-agent-debugger-label">Target Endpoint</label>
          <select
            className="mail-agent-debugger-select"
            value={api}
            onChange={(e) => {
              setApi(e.target.value as GmailApiType)
              setResponse(null)
            }}
          >
            <option value="snapshot:get">snapshot:get</option>
            <option value="messages:list">messages:list</option>
            <option value="message:get">message:get</option>
            <option value="labels:list">labels:list</option>
            <option value="labels:update">labels:update</option>
            <option value="labels:batchUpdate">labels:batchUpdate</option>
          </select>
        </div>

        {/* API-specific fields */}
        {api === "messages:list" && (
          <>
            <div className="mail-agent-debugger-field">
              <label className="mail-agent-debugger-label">Search Query (Optional)</label>
              <input
                className="mail-agent-debugger-input"
                type="text"
                placeholder="e.g. is:unread, from:me"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="mail-agent-debugger-field">
              <label className="mail-agent-debugger-label">Offset</label>
              <input
                className="mail-agent-debugger-input"
                type="number"
                min={0}
                value={offset}
                onChange={(e) => setOffset(Number(e.target.value))}
              />
            </div>
            <div className="mail-agent-debugger-field">
              <label className="mail-agent-debugger-label">Limit</label>
              <input
                className="mail-agent-debugger-input"
                type="number"
                min={1}
                max={100}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              />
            </div>
          </>
        )}

        {(api === "message:get" || api === "labels:update") && (
          <div className="mail-agent-debugger-field">
            <div className="mail-agent-debugger-field-header">
              <label className="mail-agent-debugger-label">Message / Thread ID</label>
              {(gmailSnapshot.threadId || gmailSnapshot.emailId) && (
                <button
                  type="button"
                  className="mail-agent-debugger-helper-btn"
                  onClick={useCurrentMessageId}
                >
                  Use Active ID
                </button>
              )}
            </div>
            <input
              className="mail-agent-debugger-input"
              type="text"
              placeholder="e.g. thread-f:123456789 or message-id"
              value={messageId}
              onChange={(e) => setMessageId(e.target.value)}
            />
            {gmailSnapshot.subject && (
              <span className="mail-agent-debugger-input-hint">
                Active thread subject: <strong>{gmailSnapshot.subject}</strong>
              </span>
            )}
          </div>
        )}

        {api === "labels:batchUpdate" && (
          <div className="mail-agent-debugger-field">
            <label className="mail-agent-debugger-label">Message / Thread IDs</label>
            <textarea
              className="mail-agent-debugger-input"
              rows={4}
              placeholder="One or more visible Gmail thread IDs, separated by commas or new lines"
              value={messageIds}
              onChange={(e) => setMessageIds(e.target.value)}
            />
          </div>
        )}

        {api === "labels:list" && (
          <>
            <div className="mail-agent-debugger-field">
              <label className="mail-agent-debugger-label">Filter Type</label>
              <select
                className="mail-agent-debugger-select"
                value={labelFilter}
                onChange={(e) => setLabelFilter(e.target.value as any)}
              >
                <option value="all">all</option>
                <option value="system">system</option>
                <option value="user">user</option>
              </select>
            </div>
            <div className="mail-agent-debugger-field">
              <label className="mail-agent-debugger-label">Label Name Query (Optional)</label>
              <input
                className="mail-agent-debugger-input"
                type="text"
                placeholder="e.g. Work, Inbox"
                value={labelQuery}
                onChange={(e) => setLabelQuery(e.target.value)}
              />
            </div>
          </>
        )}

        {api === "message:get" && (
          <div className="mail-agent-debugger-field checkbox">
            <label className="mail-agent-debugger-checkbox-label">
              <input
                type="checkbox"
                checked={metadataOnly}
                onChange={(e) => setMetadataOnly(e.target.checked)}
              />
              Metadata Only (do not fetch email body)
            </label>
          </div>
        )}

        {(api === "labels:update" || api === "labels:batchUpdate") && (
          <>
            <div className="mail-agent-debugger-field">
              <label className="mail-agent-debugger-label">Add Label IDs (Comma-separated)</label>
              <input
                className="mail-agent-debugger-input"
                type="text"
                placeholder="e.g. UNREAD, STARRED, IMPORTANT, Work (Move to)"
                value={addLabelIds}
                onChange={(e) => setAddLabelIds(e.target.value)}
              />
            </div>
            <div className="mail-agent-debugger-field">
              <label className="mail-agent-debugger-label">Remove Label IDs (Comma-separated)</label>
              <input
                className="mail-agent-debugger-input"
                type="text"
                placeholder="e.g. UNREAD, INBOX, STARRED, IMPORTANT"
                value={removeLabelIds}
                onChange={(e) => setRemoveLabelIds(e.target.value)}
              />
            </div>
          </>
        )}

        <button
          type="button"
          className="mail-agent-debugger-execute-btn"
          disabled={
            loading ||
            ((api === "message:get" || api === "labels:update") && !messageId.trim()) ||
            (api === "labels:batchUpdate" && parseCommaOrLineList(messageIds).length === 0)
          }
          onClick={executeApi}
        >
          {loading ? (
            <>
              <RefreshCw className="spinner animate-spin" size={14} />
              Executing API...
            </>
          ) : (
            <>
              <Play size={14} />
              Execute Call
            </>
          )}
        </button>
      </div>

      <div className="mail-agent-debugger-response">
        <div className="mail-agent-debugger-response-header">
          <span className="mail-agent-debugger-response-label">Response JSON</span>
          {response !== null && (
            <button
              type="button"
              className="mail-agent-debugger-copy-btn"
              onClick={copyToClipboard}
              title="Copy to clipboard"
            >
              {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          )}
        </div>

        <div className="mail-agent-debugger-response-body">
          {response ? (
            <>
              <pre className="mail-agent-debugger-pre">
                {JSON.stringify(response, null, 2)}
              </pre>
              {typeof response === "object" && response !== null && "logs" in response && Array.isArray((response as any).logs) && (
                <div className="mail-agent-debugger-logs">
                  <span className="mail-agent-debugger-logs-label">Diagnostic Logs</span>
                  <pre className="mail-agent-debugger-logs-pre">
                    {(response as any).logs.join("\n")}
                  </pre>
                </div>
              )}
            </>
          ) : loading ? (
            <div className="mail-agent-debugger-placeholder loading">
              Waiting for tab response...
            </div>
          ) : (
            <div className="mail-agent-debugger-placeholder">
              <Info size={16} />
              Configure parameters above and click Execute to see response.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
