const NOTICE_ID = "mail-agent-gmail-notice"
let noticeTimer: number | undefined

export function showGmailAgentNotice(title: string, body: string): void {
  const host = getOrCreateNoticeHost()
  host.textContent = ""

  const card = document.createElement("div")
  card.setAttribute("role", "status")
  card.style.cssText = [
    "background:#202124",
    "border:1px solid rgba(255,255,255,.18)",
    "border-radius:8px",
    "box-shadow:0 8px 24px rgba(0,0,0,.28)",
    "color:#fff",
    "font:13px/1.4 Arial,sans-serif",
    "max-width:360px",
    "padding:12px 14px",
    "pointer-events:auto"
  ].join(";")

  const heading = document.createElement("div")
  heading.textContent = title
  heading.style.cssText = "font-weight:600;margin-bottom:4px"
  card.appendChild(heading)

  const message = document.createElement("div")
  message.textContent = body
  message.style.cssText = "color:rgba(255,255,255,.86)"
  card.appendChild(message)

  const close = document.createElement("button")
  close.type = "button"
  close.textContent = "Dismiss"
  close.style.cssText = [
    "background:transparent",
    "border:0",
    "color:#8ab4f8",
    "cursor:pointer",
    "font:13px Arial,sans-serif",
    "margin:8px 0 0",
    "padding:0"
  ].join(";")
  close.addEventListener("click", () => host.remove())
  card.appendChild(close)

  host.appendChild(card)

  if (noticeTimer) window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    host.remove()
    noticeTimer = undefined
  }, 12000)
}

function getOrCreateNoticeHost(): HTMLElement {
  const existing = document.getElementById(NOTICE_ID)
  if (existing) return existing

  const host = document.createElement("div")
  host.id = NOTICE_ID
  host.style.cssText = [
    "bottom:24px",
    "position:fixed",
    "right:24px",
    "z-index:2147483647",
    "pointer-events:none"
  ].join(";")
  document.documentElement.appendChild(host)
  return host
}
