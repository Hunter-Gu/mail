/**
 * MIME tree parser for Gmail API `format: "full"` payloads.
 *
 * Gmail returns messages as a nested MessagePart tree:
 *
 *   multipart/mixed
 *     └─ multipart/alternative
 *          ├─ text/plain        ← preferred
 *          └─ multipart/related
 *               ├─ text/html   ← fallback, stripped to plain text
 *               └─ image/png
 *
 * A fixed-depth traversal breaks on real-world nesting, so we recurse.
 * See: https://developers.google.com/gmail/api/reference/rest/v1/users.messages#Message.MessagePart
 */

import type { GmailMessagePart } from "../types"

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract a human-readable plain-text body from a Gmail MessagePart payload.
 * Prefers `text/plain`; falls back to `text/html` stripped of tags.
 * Returns an empty string if neither is found.
 */
export function extractBody(payload: GmailMessagePart): string {
  const plain = findPart(payload, "text/plain")
  if (plain) return decodePartData(plain)

  const html = findPart(payload, "text/html")
  if (html) return htmlToText(decodePartData(html))

  return ""
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Recursively walk the MessagePart tree and return the base64url-encoded
 * `body.data` of the first leaf node whose mimeType matches.
 */
function findPart(part: GmailMessagePart, mimeType: string): string | null {
  if (part.mimeType === mimeType) {
    const data = part.body?.data
    if (typeof data === "string" && data.length > 0) return data
  }

  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      const found = findPart(child, mimeType)
      if (found) return found
    }
  }

  return null
}

/**
 * Decode a base64url-encoded string (as used by the Gmail API) to UTF-8 text.
 * Note: Gmail uses base64url (`-` and `_`), NOT standard base64 (`+` and `/`).
 */
function decodePartData(data: string): string {
  let base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  if (pad) {
    base64 += "=".repeat(4 - pad);
  }
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Strip HTML tags and decode common entities, producing readable plain text.
 * Good enough for agent triage; not a full HTML renderer.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
