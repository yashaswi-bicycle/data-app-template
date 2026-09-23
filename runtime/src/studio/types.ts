/**
 * The contract between a generated app and the service that hosts it.
 */

export type BdaContext = {
  readonly v: 1
  readonly appId: string
  readonly version: number
  /** API root, absolute or service-relative. Supplied by the embed page. */
  readonly apiBase: string
  /** Short-lived view token. Replaced in place when the host re-mints it. */
  readonly token: string
  readonly expiresAt: string
  /**
   * The theme in effect when the app booted.
   *
   * A snapshot, not a subscription: the viewer can change their system theme
   * while the page is open. Read `currentTheme()` from `studio/theme.js` for
   * the live value, and `onThemeChange` to be told when it moves.
   */
  readonly theme: 'dark' | 'light'
  /**
   * What the host asked for. `'system'` — the normal case — means follow
   * `prefers-color-scheme`.
   *
   * Optional because an app bundle can outlive the embed page that framed it:
   * a bundle built against this field and loaded by an older frame reads
   * `undefined` and falls back to following the system.
   */
  readonly themePreference?: 'system' | 'light' | 'dark'
  /**
   * Where a deep link lands (T9.0). The host turns a link — or a scheduled
   * capture — into this, and injects it with the rest of the context before
   * the bundle loads, so the runtime adopts it *before* the first query is
   * issued rather than re-querying after a hydration pass.
   *
   * Optional, like `themePreference`: a bundle built against this field and
   * framed by an older embed page reads `undefined` and starts from the
   * spec's own defaults.
   */
  readonly state?: RenderState
}

/* -------------------------------------------------- deep link / readiness */

/**
 * How far along a panel's own data is (T9.0), reported on every entry of
 * `studio:sandbox:context`. A host waiting to capture, to highlight or to
 * ask a question about a panel reads this rather than guessing from the
 * digest's presence.
 *
 * - `loading` — at least one of the panel's queries is still in flight.
 * - `ready` — every query resolved and there is something to show.
 * - `empty` — every query resolved and there are no rows.
 * - `error` — a query failed.
 */
export type PanelStatus = 'loading' | 'ready' | 'empty' | 'error'

/** Worst-first, so a recipe rendering several cards for one panel reports the worst of them. */
export const PANEL_STATUS_ORDER: readonly PanelStatus[] = ['error', 'loading', 'empty', 'ready']

/** The worse of two panel statuses, per `PANEL_STATUS_ORDER`. */
export function worstStatus(left: PanelStatus, right: PanelStatus): PanelStatus {
  return PANEL_STATUS_ORDER.indexOf(left) <= PANEL_STATUS_ORDER.indexOf(right) ? left : right
}

/** A time window as a deep link states it: a declared preset id, or an explicit ISO range. */
export type RenderTimeState = {
  /** A preset id the spec's `time` control declares (`7d`, `30d`, `90d`, `quarter`, `ytd`). */
  readonly preset?: string
  /** ISO date (`YYYY-MM-DD`). Both ends are needed; one on its own is dropped. */
  readonly from?: string
  readonly to?: string
}

/**
 * The initial state the host hands the frame (T9.0). Everything is optional
 * and everything is checked against the spec: an unknown filter id, a value
 * a filter does not offer, an undeclared preset or an unparseable date is
 * dropped and named in the `studio:sandbox:state` message's `dropped` list
 * rather than silently narrowing the app to nothing.
 */
export type RenderState = {
  /** ISO date. Pins every query's as-of by clamping the time window's upper bound to it. */
  readonly asOf?: string
  readonly time?: RenderTimeState
  /** Filter id (this kit: the `filter` control's `dim`) -> selected values. */
  readonly filters?: Readonly<Record<string, readonly string[]>>
  /** Section/tab id, for apps that declare sections. Carried through untouched. */
  readonly section?: string
  /** Panel id to highlight once ready. The host owns the highlight (`studio:sandbox:highlight`); the runtime ignores this field. */
  readonly panel?: string
  /** Presentation-only: hide the interactive chrome the kit owns and stop animating, for a capture. */
  readonly snapshot?: boolean
  /**
   * The last completed result of each declared analysis, by analysis id, when the host has one to
   * hand a capture. A `changes` panel never runs its analysis in snapshot mode: it shows this, or
   * says the analysis was not run. Shape: the service's `AnalysisResult`.
   */
  readonly analyses?: Readonly<Record<string, unknown>>
}

/**
 * What the frame actually adopted, minus the app's defaults — the state a
 * link has to carry to reproduce what is on screen (E9 contract 6).
 * `filters` is always present and holds only filters that differ from their
 * seed (`{}` when none do); `time` appears only when it is not the default
 * window; `asOf` and `section` whenever set.
 */
export type AppliedState = {
  readonly asOf?: string
  readonly time?: RenderTimeState
  readonly filters: Readonly<Record<string, readonly string[]>>
  readonly section?: string
}

/** Why one deep-link parameter was not applied (E9 contract 7). */
export type DropReason = 'unknown_filter' | 'invalid_value' | 'undeclared_preset' | 'invalid_date'

/**
 * One deep-link parameter the frame could not honour. `id` is the parameter
 * it came from — `f.<dim>`, `t`, `asof` or `s`; the host renders its own
 * sentence from `id` + `reason`. Deduped: one entry per `id` + `reason`.
 */
export type DroppedParam = { readonly id: string; readonly reason: DropReason }

/**
 * Frame -> host: the state in effect, sent once after the initial state is
 * applied and again on every change a person makes in the FilterBar, the
 * time controls or the section. Only what differs from the app's defaults
 * is in `state` (E9 contract 6): an untouched view is `{ filters: {} }`.
 * `dropped` carries what the host asked for and the spec could not honour,
 * e.g. `[{ id: "f.channel", reason: "unknown_filter" }, { id: "t", reason: "undeclared_preset" }]`.
 *
 * `kind` rather than `type`, deliberately: this is a state announcement, not
 * a request/response pair like `studio:sandbox:query` — pinned by
 * `evals/state.test.tsx` and by the host's own reader.
 */
export type StateMessage = {
  readonly kind: 'studio:sandbox:state'
  readonly state: AppliedState
  readonly dropped: readonly DroppedParam[]
}

export type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains'

export type Scalar = string | number | boolean | null

export type Filter = {
  /** Must be a column the app's manifest declared for this query. */
  readonly field: string
  readonly op: FilterOp
  readonly value?: Scalar
  readonly values?: readonly Scalar[]
}

export type Sort = { readonly field: string; readonly dir: 'asc' | 'desc' }

export type QueryColumn = { readonly name: string; readonly type: string }

export type QueryResult = {
  readonly columns: readonly QueryColumn[]
  readonly rows: readonly (readonly unknown[])[]
  readonly meta: {
    readonly rowCount: number
    readonly truncated: boolean
    readonly elapsedMs?: number
  }
}

export type QueryOptions = {
  readonly parameters?: Readonly<Record<string, Scalar>>
  readonly filters?: readonly Filter[]
  readonly sort?: readonly Sort[]
  readonly limit?: number
}

/**
 * A failure from the service, with the code to branch on.
 *
 * `token_expired` is the one worth handling: the host page re-mints on a timer,
 * so the right response is to let the next attempt succeed rather than to show
 * the user an error.
 */
export class BdaError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'BdaError'
  }
}

declare global {
  interface Window {
    __BDA_CONTEXT?: BdaContext
  }
}
