/**
 * The frame's context reporter.
 *
 * Invariant 9 (AGENTS.md): the chat UI is host-owned. This module never
 * renders anything — it only reports what is on screen, so a chat living in
 * the host page can reason about it, and it listens for the one message the
 * host may send back (`studio:sandbox:highlight`) to point at a panel already
 * on the page. Nothing here shows a bubble, a drawer or an ask box.
 *
 * A "panel" is one entry the composer resolved (`spec.panels[i]`), reported
 * under a stable id — its resolved index plus its recipe, e.g. `p3:ranking`.
 * A recipe may render more than one card for one panel (the `ranking` recipe's
 * top/bottom tables, `kpis`' one tile per measure); their geometry is unioned
 * and their digests merged so the host still sees one panel.
 */

import { createContext, type RefObject, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { type AppliedState, type DroppedParam, type PanelStatus, type StateMessage, worstStatus } from './types.js'

export type PanelRect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly scrollX: number
  readonly scrollY: number
}

export type PanelReport = {
  readonly panelId: string
  readonly recipe: string
  readonly say?: string
  readonly bind: Readonly<Record<string, unknown>>
  readonly selection?: unknown
  readonly digest?: unknown
  /**
   * What kind of panel this is, when a recipe is more than its `recipe` id
   * says — today just `'summary'` (T5.4), so the host's ask overlay can tell
   * the summary panel apart from a plain recipe card without special-casing
   * `recipe === 'summary'` itself.
   */
  readonly kind?: string
  /** The chat thread this panel's own answer came from (`summary`'s `thread_id`), so a follow-up in the host's ask overlay can continue it instead of starting a new one. */
  readonly threadId?: string
  /**
   * How far along this panel's own data is (T9.0). A recipe rendering
   * several cards for one panel reports the worst of them — error over
   * loading over empty over ready — so a host waiting on "is this panel
   * ready" never sees `ready` while one of its cards is still a skeleton.
   */
  readonly status: PanelStatus
  readonly rect: PanelRect
  /**
   * The findings this panel shows, when it shows any (a `changes` panel) —
   * what the host's "Why?" pill offers to explain. The row the viewer picked
   * is named by `selection.findingKey`. At most `MAX_REPORTED_FINDINGS`.
   */
  readonly findings?: readonly FindingReport[]
}

/**
 * One finding as the host needs it to start an agent run about it: the keys,
 * the subject it is about, the DE job it came from and the row (trimmed to the
 * values the run snapshots and the service's stale check reads).
 */
export type FindingReport = {
  readonly findingKey: string
  readonly subjectKey?: string
  readonly jobId?: string
  readonly subject?: Readonly<Record<string, unknown>>
  readonly row: Readonly<Record<string, unknown>>
  /** The panel's narrowed filters, forwarded with a run the host starts (Studio's `context.filters`). */
  readonly filters?: readonly { readonly field: string; readonly op: string; readonly value: unknown }[]
}

export const MAX_REPORTED_FINDINGS = 25

export type ContextMessage = {
  readonly type: 'studio:sandbox:context'
  readonly panels: readonly PanelReport[]
  readonly tokens: Readonly<Record<string, string>>
}

export type HighlightMessage = {
  readonly type: 'studio:sandbox:highlight'
  readonly panelId: string
}

export type { AppliedState, DroppedParam, PanelStatus, StateMessage }

/**
 * The `--bda-*` custom properties declared on `:root` in `theme.css`.
 *
 * Kept as one list rather than re-parsed from the stylesheet at runtime: the
 * values a token resolves to are per-theme and per-accent, but the *names*
 * are fixed, and this is the one place that enumerates them.
 */
export const THEME_TOKENS: readonly string[] = [
  '--bda-surface-background',
  '--bda-surface-raised',
  '--bda-surface-overlay',
  '--bda-text-primary',
  '--bda-text-secondary',
  '--bda-border',
  '--bda-grid',
  '--bda-accent',
  '--bda-accent-soft',
  '--bda-accent-muted',
  '--bda-positive',
  '--bda-negative',
  '--bda-chart-1',
  '--bda-chart-2',
  '--bda-chart-3',
  '--bda-chart-4',
  '--bda-chart-5',
  '--bda-chart-6',
  '--bda-font-family',
  '--bda-font-size',
  '--bda-radius',
  '--bda-radius-pill',
  '--bda-space-1',
  '--bda-space-2',
  '--bda-space-3',
  '--bda-space-4',
  '--bda-space-5',
  '--bda-shadow',
]

function readTokens(): Record<string, string> {
  if (typeof document === 'undefined') return {}
  const style = getComputedStyle(document.documentElement)
  const tokens: Record<string, string> = {}
  for (const name of THEME_TOKENS) {
    const value = style.getPropertyValue(name).trim()
    if (value.length > 0) tokens[name] = value
  }
  return tokens
}

/** A digest is a courtesy, not a contract: too big and it is trimmed, never thrown. */
const DIGEST_BUDGET_BYTES = 2048

function withinBudget(value: unknown): unknown {
  if (value === undefined) return undefined
  let json: string
  try {
    json = JSON.stringify(value)
  } catch {
    return undefined
  }
  if (json.length <= DIGEST_BUDGET_BYTES) return value
  if (!Array.isArray(value)) return undefined
  const copy = [...value]
  while (copy.length > 0 && JSON.stringify(copy).length > DIGEST_BUDGET_BYTES) copy.pop()
  return copy.length > 0 ? copy : undefined
}

type Instance = {
  readonly recipe: string
  readonly status: PanelStatus
  readonly say: string | undefined
  readonly bind: Readonly<Record<string, unknown>>
  readonly digest: unknown
  readonly node: Element
  readonly kind?: string
  readonly threadId?: string
  readonly findings?: readonly FindingReport[]
}

type PanelState = {
  readonly instances: Map<string, Instance>
  selection: unknown
}

const panels = new Map<string, PanelState>()
const highlightListeners = new Map<string, Set<() => void>>()

let reportTimer: ReturnType<typeof setTimeout> | undefined
let rafScheduled = false
let listening = false

function stateOf(panelId: string): PanelState {
  let state = panels.get(panelId)
  if (state === undefined) {
    state = { instances: new Map(), selection: undefined }
    panels.set(panelId, state)
  }
  return state
}

function rectOf(node: Element): PanelRect {
  const box = node.getBoundingClientRect()
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    scrollX: typeof window === 'undefined' ? 0 : window.scrollX,
    scrollY: typeof window === 'undefined' ? 0 : window.scrollY,
  }
}

function unionRect(instances: readonly Instance[]): PanelRect {
  const rects = instances.map((instance) => rectOf(instance.node))
  const first = rects[0]
  if (first === undefined) return { x: 0, y: 0, width: 0, height: 0, scrollX: 0, scrollY: 0 }
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top, scrollX: first.scrollX, scrollY: first.scrollY }
}

/** Worst-of across a panel's cards (`error` > `loading` > `empty` > `ready`); `loading` for a panel with no card yet. */
export function mergeStatus(instances: readonly Pick<Instance, 'status'>[]): PanelStatus {
  if (instances.length === 0) return 'loading'
  return instances.reduce<PanelStatus>((worst, instance) => worstStatus(worst, instance.status), 'ready')
}

/**
 * More than one card can share a panel id — `kpis` renders one `Widget` per
 * measure, `ranking` renders a top and a bottom table. One card's digest is
 * used as-is; several are combined into one list (array digests flatten into
 * it rather than nesting) so the host still sees a single, flat digest per
 * panel.
 */
function mergeDigests(instances: readonly Instance[]): unknown {
  const defined = instances.map((instance) => instance.digest).filter((digest) => digest !== undefined)
  if (defined.length === 0) return undefined
  if (defined.length === 1) return defined[0]
  return defined.flatMap((digest) => (Array.isArray(digest) ? digest : [digest]))
}

/** Every card's findings, first card first, deduped by key and capped. Absent when no card reports any. */
function mergedFindings(instances: readonly Instance[]): { findings?: readonly FindingReport[] } {
  const seen = new Set<string>()
  const out: FindingReport[] = []
  for (const instance of instances) {
    for (const finding of instance.findings ?? []) {
      if (seen.has(finding.findingKey) || out.length >= MAX_REPORTED_FINDINGS) continue
      seen.add(finding.findingKey)
      out.push(finding)
    }
  }
  return out.length === 0 ? {} : { findings: out }
}

function buildReport(): readonly PanelReport[] {
  const out: PanelReport[] = []
  for (const [panelId, state] of panels) {
    const instances = [...state.instances.values()]
    const last = instances[instances.length - 1]
    if (last === undefined) continue
    const digest = withinBudget(mergeDigests(instances))
    out.push({
      panelId,
      recipe: last.recipe,
      ...(last.say === undefined ? {} : { say: last.say }),
      bind: last.bind,
      ...(state.selection === undefined ? {} : { selection: state.selection }),
      ...(digest === undefined ? {} : { digest }),
      ...(last.kind === undefined ? {} : { kind: last.kind }),
      ...(last.threadId === undefined ? {} : { threadId: last.threadId }),
      status: mergeStatus(instances),
      rect: unionRect(instances),
      ...mergedFindings(instances),
    })
  }
  return out
}

function post(): void {
  if (typeof window === 'undefined' || window.parent === window) return
  const message: ContextMessage = { type: 'studio:sandbox:context', panels: buildReport(), tokens: readTokens() }
  window.parent.postMessage(message, '*')
}

/**
 * Frame -> host: the filter/time/section state in effect (T9.0, contract 3).
 *
 * Same channel and the same origin rule as the context report above — one
 * `postMessage` to the parent, and nothing at all when this frame is not
 * embedded. Sent by `ControlsProvider` (controls.tsx), which owns that
 * state: once when the host's initial state has been applied, then on every
 * change a person makes.
 */
export function reportState(state: AppliedState, dropped: readonly DroppedParam[]): void {
  if (typeof window === 'undefined' || window.parent === window) return
  const message: StateMessage = { kind: 'studio:sandbox:state', state, dropped }
  window.parent.postMessage(message, '*')
}

/**
 * The panels currently on screen, exactly as the host's own
 * `studio:sandbox:context` message would report them. Used by the `summary`
 * recipe (T5.4) to build the `context` array its own
 * `studio:sandbox:summary` request sends — the same "panels as the context
 * reporter sees them" shape the service's `/summary` and `/chat/threads`
 * bodies both accept, not a new one invented for this request kind.
 */
export function currentPanelReports(): readonly PanelReport[] {
  return buildReport()
}

/** Registry change: debounced 100ms. */
function scheduleReport(): void {
  if (typeof window === 'undefined') return
  if (reportTimer !== undefined) clearTimeout(reportTimer)
  reportTimer = setTimeout(() => {
    reportTimer = undefined
    post()
  }, 100)
}

/** Scroll/resize: rAF-throttled — geometry only, so there is no need to wait 100ms. */
function scheduleGeometryReport(): void {
  if (rafScheduled || typeof window === 'undefined') return
  rafScheduled = true
  window.requestAnimationFrame(() => {
    rafScheduled = false
    post()
  })
}

function onIncomingMessage(event: MessageEvent<Partial<HighlightMessage> | undefined>): void {
  const data = event.data
  if (data === null || typeof data !== 'object' || data.type !== 'studio:sandbox:highlight') return
  const panelId = (data as HighlightMessage).panelId
  if (typeof panelId !== 'string') return
  for (const listener of highlightListeners.get(panelId) ?? []) listener()
}

function ensureListening(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('scroll', scheduleGeometryReport, { passive: true, capture: true })
  window.addEventListener('resize', scheduleGeometryReport)
  window.addEventListener('message', onIncomingMessage)
  // Once after first paint: two rAFs so the browser has actually painted the
  // frame that just registered, not merely scheduled it.
  window.requestAnimationFrame(() => window.requestAnimationFrame(post))
}

/** One rendered card, registered under a panel id. Several cards may share a panel id. */
export function registerInstance(panelId: string, instanceId: string, instance: Instance): void {
  ensureListening()
  stateOf(panelId).instances.set(instanceId, instance)
  scheduleReport()
}

export function unregisterInstance(panelId: string, instanceId: string): void {
  const state = panels.get(panelId)
  if (state === undefined) return
  state.instances.delete(instanceId)
  if (state.instances.size === 0 && state.selection === undefined) panels.delete(panelId)
  scheduleReport()
}

/** A card's own geometry changed (its `ResizeObserver` fired). No registry change, just a re-report. */
export function notifyGeometryChange(): void {
  scheduleGeometryReport()
}

export function setPanelSelection(panelId: string, selection: unknown): void {
  stateOf(panelId).selection = selection
  scheduleReport()
}

export function getPanelSelection(panelId: string): unknown {
  return panels.get(panelId)?.selection
}

/** Subscribe to `studio:sandbox:highlight` for one panel id. Returns an unsubscribe. */
export function onHighlight(panelId: string, listener: () => void): () => void {
  let set = highlightListeners.get(panelId)
  if (set === undefined) {
    set = new Set()
    highlightListeners.set(panelId, set)
  }
  const current = set
  current.add(listener)
  return () => {
    current.delete(listener)
    if (current.size === 0) highlightListeners.delete(panelId)
  }
}

/** Test seam: flush the debounce immediately instead of waiting on it. */
export function flushReportForTests(): void {
  if (reportTimer !== undefined) clearTimeout(reportTimer)
  reportTimer = undefined
  post()
}

/** Test seam: reset all module state between cases. */
export function resetRegistryForTests(): void {
  panels.clear()
  highlightListeners.clear()
  if (reportTimer !== undefined) clearTimeout(reportTimer)
  reportTimer = undefined
  rafScheduled = false
  if (listening && typeof window !== 'undefined') {
    window.removeEventListener('scroll', scheduleGeometryReport, true)
    window.removeEventListener('resize', scheduleGeometryReport)
    window.removeEventListener('message', onIncomingMessage)
  }
  listening = false
}

/* ------------------------------------------------------------ React glue */

/**
 * What a panel is, as the composer resolved it — carried down to `Widget`
 * and to a recipe's own click handlers.
 *
 * `explain` is carried here for the in-frame Provenance popover's Method
 * section only. It deliberately does NOT flow into `PanelReport`/
 * `ContextMessage` above — the host's context reporter wire protocol is
 * pinned by `evals/context.test.tsx` and this repo's default is to keep that
 * message exactly as-is unless there's a specific reason to grow it.
 */
export type PanelMeta = {
  readonly panelId: string
  readonly recipe: string
  readonly say: string | undefined
  readonly bind: Readonly<Record<string, unknown>>
  readonly explain?: string
  /**
   * What kind of panel this is, beyond its `recipe` id — the `summary`
   * recipe (T5.4) is the one case today. Static per panel, unlike
   * `threadId` below (which a recipe only learns once its own response
   * lands), so a recipe that knows it up front may pass it here; one that
   * learns it later passes it straight to `Widget`'s own `kind`/`threadId`
   * props instead (see `useRegisterPanelInstance`'s `extra` argument).
   */
  readonly kind?: string
  /** See `PanelReport.threadId`. Usually left unset here — a recipe fills this in once its own answer lands, via `Widget`'s `threadId` prop, not through this static, composer-resolved metadata. */
  readonly threadId?: string
}

const PanelMetaContext = createContext<PanelMeta | undefined>(undefined)

export const PanelMetaProvider = PanelMetaContext.Provider

/** `undefined` outside a resolved panel — a fixture rendering a recipe directly, say. */
export function usePanelMeta(): PanelMeta | undefined {
  return useContext(PanelMetaContext)
}

export function usePanelId(): string | undefined {
  return usePanelMeta()?.panelId
}

/**
 * A panel's current selection (the picked row/point/cell), and a setter that
 * reports it to the host. `panelId` is `usePanelId()`'s result — pass it
 * through explicitly so a recipe's click handler can be defined once, outside
 * any conditional, even when `usePanelMeta()` might be `undefined`.
 */
export function useSelection<T = unknown>(panelId: string | undefined): readonly [T | undefined, (value: T | undefined) => void] {
  const [value, setValue] = useState<T | undefined>(() => (panelId === undefined ? undefined : (getPanelSelection(panelId) as T | undefined)))
  const set = useMemo(
    () => (next: T | undefined) => {
      setValue(next)
      if (panelId !== undefined) setPanelSelection(panelId, next)
    },
    [panelId],
  )
  return [value, set] as const
}

/**
 * Registers one rendered widget card for as long as it is mounted, keeps its
 * geometry fresh, and calls `onHighlight` back when the host points at it.
 * `Widget` (parts.tsx) is the only caller; a recipe never calls this itself.
 */
export function useRegisterPanelInstance(
  meta: PanelMeta | undefined,
  digest: unknown,
  /** This card's own readiness, derived by `Widget` from its query props. Re-registering on a change is what makes a status move re-report, not only a digest move (T9.0, contract 1). */
  status: PanelStatus,
  /** Overrides `meta.kind`/`meta.threadId` — how `Widget`'s own `kind`/`threadId` props (dynamic, learned after the recipe's own data lands) reach the registry, since `PanelMeta` itself is static per render. */
  extra?: { readonly kind?: string | undefined; readonly threadId?: string | undefined; readonly findings?: readonly FindingReport[] | undefined },
): { readonly nodeRef: RefObject<HTMLDivElement | null>; readonly highlighted: boolean } {
  const nodeRef = useRef<HTMLDivElement>(null)
  const instanceId = useId()
  const [highlighted, setHighlighted] = useState(false)
  const kind = extra?.kind ?? meta?.kind
  const threadId = extra?.threadId ?? meta?.threadId
  const findings = extra?.findings

  useEffect(() => {
    if (meta === undefined) return
    const node = nodeRef.current
    if (node === null) return
    registerInstance(meta.panelId, instanceId, {
      recipe: meta.recipe,
      status,
      say: meta.say,
      bind: meta.bind,
      digest,
      node,
      ...(kind === undefined ? {} : { kind }),
      ...(threadId === undefined ? {} : { threadId }),
      ...(findings === undefined ? {} : { findings }),
    })
    const observer = new ResizeObserver(() => notifyGeometryChange())
    observer.observe(node)
    return () => {
      observer.disconnect()
      unregisterInstance(meta.panelId, instanceId)
    }
  }, [meta, instanceId, digest, status, kind, threadId, findings])

  // A pulse the host asked for: scroll the card into view and hold
  // `kit-card--highlight` for 1.6s (the CSS-only pulse is in theme.css).
  useEffect(() => {
    if (meta === undefined) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = onHighlight(meta.panelId, () => {
      nodeRef.current?.scrollIntoView({ block: 'center' })
      setHighlighted(true)
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => setHighlighted(false), 1600)
    })
    return () => {
      unsubscribe()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [meta])

  return { nodeRef, highlighted }
}
