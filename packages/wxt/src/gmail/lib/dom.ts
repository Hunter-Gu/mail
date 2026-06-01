export function isVisible(el: HTMLElement): boolean {
  return Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
}

export function clickGmailButton(el: HTMLElement): void {
  el.scrollIntoView({ block: "center", inline: "center" })
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
    el.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window
    }))
  }
  el.click()
}

export function safeClick(el: HTMLElement | null | undefined): boolean {
  if (!el) return false
  clickGmailButton(el)
  return true
}
