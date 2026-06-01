import type { GmailLabel } from "agent"
import { mainWorldBridge, safeCall, stringValue } from "../state"
import {
  labelIdToName,
  normalizeLabelId,
  systemLabels
} from "./label-model"

type OmniLabelCatalogResult = {
  labels?: GmailLabel[]
  complete?: boolean
  source?: string
  error?: string
}

export type OmniLabelsProbe = {
  labels: GmailLabel[] | null
  source?: string
  failureReason?: string
}

export async function getOmniLabelsFromMainWorld(
  log: (msg: string) => void
): Promise<OmniLabelsProbe> {
  if (!mainWorldBridge.call) {
    log("MAIN world bridge is not initialized; skipping Gmail view=omni labels API.")
    return {
      labels: null,
      failureReason: "MAIN world bridge is not initialized"
    }
  }

  log("Attempting Gmail view=omni labels API before DOM fallback...")
  const result = await mainWorldBridge.call("labels_omni").catch((err) => {
    const message = err instanceof Error ? err.message : String(err)
    log(`Gmail view=omni labels API failed: ${message}`)
    return undefined
  }) as OmniLabelCatalogResult | undefined

  if (!result?.complete || !Array.isArray(result.labels) || result.labels.length === 0) {
    const failureReason = result?.error || "MAIN world returned no labels"
    log(`Gmail view=omni labels API did not return labels (${failureReason}); using DOM fallback.`)
    return {
      labels: null,
      failureReason
    }
  }

  const labels = result.labels
    .flatMap((label) => {
      const rawName = stringValue(label.name)
      const id = normalizeLabelId(stringValue(label.id) || rawName)
      const name = rawName || labelIdToName(id)
      if (!id || !name) return []
      const isSystem = label.type === "system" || systemLabels.some((system) =>
        system.id === id || system.name.toUpperCase() === name.toUpperCase()
      )
      return [{
        ...label,
        id,
        name,
        type: isSystem ? ("system" as const) : ("user" as const)
      }]
    })

  log(`Gmail view=omni labels API returned ${labels.length} labels from ${result.source || "unknown source"}.`)
  return {
    labels,
    source: result.source
  }
}

export async function getCustomLabelsFromDom(log: (msg: string) => void): Promise<string[]> {
  log("Starting getCustomLabelsFromDom...")
  const moreBtn = document.querySelector<HTMLElement>(
    'span.n6, div.n6, div[data-tooltip*="More"], div[data-tooltip*="更多"], [aria-label*="More"], [aria-label*="更多"]'
  )
  if (moreBtn) {
    const text = moreBtn.textContent?.trim() || ""
    log(`Found potential 'More' button: "${text}"`)
    if (text.includes("More") || text.includes("更多") || moreBtn.querySelector(".custom-more-icon")) {
      log("Clicking 'More' button to expand sidebar labels...")
      safeCall(() => moreBtn.click())
    }
  } else {
    log("No 'More' button found in sidebar drawer.")
  }

  const navContainer = document.querySelector('[role="navigation"]')
  if (navContainer) {
    log("Found role='navigation' container.")
  } else {
    log("No role='navigation' container found.")
  }

  const labels: string[] = []

  const labelsSections = document.querySelectorAll(
    '[aria-label="Labels"], [aria-label="标签"], [data-tooltip="Labels"], [data-tooltip="标签"]'
  )
  log(`Strategy A: Found ${labelsSections.length} container sections with "Labels" / "标签" aria-label or tooltip.`)

  labelsSections.forEach((section, sIdx) => {
    const links = section.querySelectorAll("a")
    log(`  Section #${sIdx + 1} has ${links.length} anchor tags.`)
    links.forEach((link, lIdx) => {
      const href = link.getAttribute("href") || ""
      const text = link.textContent?.trim() || ""
      const title = link.getAttribute("title") || ""
      log(`    Link #${lIdx + 1}: text="${text}", title="${title}", href="${href}"`)

      const cleanName = text.replace(/\(\d+\)$/, "").trim()
      if (cleanName && cleanName !== "Labels" && cleanName !== "标签" && cleanName !== "More" && cleanName !== "Less" && cleanName !== "更多" && cleanName !== "更少") {
        if (!labels.includes(cleanName)) {
          log(`    -> Strategy A matched custom label: "${cleanName}"`)
          labels.push(cleanName)
        }
      }
    })
  })

  const elements = document.querySelectorAll("a[href]")
  log(`Strategy B: Scanning all ${elements.length} anchor elements in document.`)

  let processedLinksCount = 0
  elements.forEach((el) => {
    const href = el.getAttribute("href")
    const text = el.textContent?.trim() || ""
    const title = el.getAttribute("title") || ""

    if (href) {
      let decodedHref = href
      try {
        decodedHref = decodeURIComponent(href)
      } catch {
        // Keep the raw href when Gmail provides a partially encoded value.
      }

      const lowerDecoded = decodedHref.toLowerCase()
      const isLabelLink = lowerDecoded.includes("label") || lowerDecoded.includes("%2f") || lowerDecoded.includes("%3a")

      if (isLabelLink && processedLinksCount < 50) {
        processedLinksCount++
        log(`Inspecting label link #${processedLinksCount}: text="${text}", title="${title}", href="${href}", decoded="${decodedHref}"`)
      }

      const labelIndex = lowerDecoded.indexOf("#label/")
      const searchIndex = lowerDecoded.indexOf("label:")
      const labelEncIndex = lowerDecoded.indexOf("#label%2f")
      const searchEncIndex = lowerDecoded.indexOf("label%3a")

      let labelName = ""
      if (labelIndex !== -1) {
        labelName = decodedHref.slice(labelIndex + 7)
      } else if (labelEncIndex !== -1) {
        labelName = decodedHref.slice(labelEncIndex + 9)
      } else if (searchIndex !== -1) {
        labelName = decodedHref.slice(searchIndex + 6)
      } else if (searchEncIndex !== -1) {
        labelName = decodedHref.slice(searchEncIndex + 8)
      }

      if (labelName) {
        const cleanLabelName = labelName.split("?")[0].replace(/\(\d+\)$/, "").trim()
        if (cleanLabelName && !labels.includes(cleanLabelName)) {
          log(`    -> Strategy B matched custom label: "${cleanLabelName}"`)
          labels.push(cleanLabelName)
        }
      }
    }
  })

  if (mainWorldBridge.call) {
    log("MAIN world gmail-js is initialized, attempting gmail.get.labels()...")
    const jsLabels = await mainWorldBridge.call("labels").catch(() => undefined)
    log(`gmail.get.labels() returned: ${JSON.stringify(jsLabels)}`)
    if (Array.isArray(jsLabels)) {
      jsLabels.forEach((name) => {
        if (typeof name === "string" && name.trim()) {
          const trimmed = name.trim()
          if (!labels.includes(trimmed)) {
            log(`  -> Strategy C matched custom label from gmail-js: "${trimmed}"`)
            labels.push(trimmed)
          }
        }
      })
    }
  } else {
    log("MAIN world gmail-js bridge is not initialized.")
  }

  log(`Completed getCustomLabelsFromDom. Found ${labels.length} custom labels: ${JSON.stringify(labels)}`)
  return labels
}
