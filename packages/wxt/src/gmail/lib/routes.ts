import {
  isObject,
  safeCall,
  state,
  stringValue
} from "../state"

type InboxSdkRouteContext =
  | {
      ok: true
      router: any
      routeId: string
      routeType?: string
      params: Record<string, string>
    }
  | { ok: false; reason: string }

export function getInboxSdkRouteContext(): InboxSdkRouteContext {
  const router = state.inboxSdk?.Router as any
  if (!router) {
    return { ok: false, reason: "InboxSDK Router is unavailable" }
  }

  const routeView = safeCall(() => router.getCurrentRouteView?.())
  if (!routeView) {
    return { ok: false, reason: "InboxSDK current route view is unavailable" }
  }

  const routeId = stringValue(safeCall(() => routeView.getRouteID?.()))
  if (!routeId) {
    return { ok: false, reason: "InboxSDK current route id is unavailable" }
  }

  return {
    ok: true,
    router,
    routeId,
    routeType: stringValue(safeCall(() => routeView.getRouteType?.())),
    params: normalizeInboxSdkRouteParams(safeCall(() => routeView.getParams?.()))
  }
}

export function getInboxSdkListRouteContext(): InboxSdkRouteContext {
  const context = getInboxSdkRouteContext()
  if (!context.ok) return context

  const listRouteType = stringValue(safeCall(() => context.router.RouteTypes?.LIST))
  if (context.routeType && listRouteType && context.routeType !== listRouteType) {
    return { ok: false, reason: `InboxSDK current route is not a list route (${context.routeType})` }
  }

  return context
}

export function getCurrentInboxSdkSearchQuery(): string | undefined {
  const context = getInboxSdkRouteContext()
  if (!context.ok) return undefined

  const searchRouteId = stringValue(safeCall(() => context.router.NativeRouteIDs?.SEARCH))
  if (searchRouteId && context.routeId !== searchRouteId) return undefined

  return context.params.query
}

export function getCurrentInboxSdkListPageNumber(): number {
  const context = getInboxSdkListRouteContext()
  if (!context.ok) return 1
  return parseInboxSdkPageNumber(context.params.page)
}

export function buildInboxSdkPageParams(
  params: Record<string, string>,
  pageNumber: number
): Record<string, string> {
  const nextParams = { ...params }
  if (pageNumber <= 1) {
    delete nextParams.page
  } else {
    nextParams.page = formatInboxSdkPageLabel(pageNumber)
  }
  return nextParams
}

export function formatInboxSdkPageLabel(pageNumber: number): string {
  return pageNumber <= 1 ? "first page" : `p${pageNumber}`
}

function normalizeInboxSdkRouteParams(value: unknown): Record<string, string> {
  if (!isObject(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, raw]) => [key, stringValue(raw)] as const)
      .filter(([, raw]) => raw.length > 0)
  )
}

function parseInboxSdkPageNumber(value: string | undefined): number {
  if (!value) return 1
  const parsed = Number(value.replace(/^p/i, "").replace(/[^\d]/g, ""))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}
