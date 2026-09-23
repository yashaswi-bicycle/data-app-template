/**
 * Filter + time control state (T3.3), plus the pure functions that turn it
 * into query parameters and client-side row filters.
 *
 * A `filter` control narrows one declared dimension; the composer gives the
 * datasets that aggregate that dimension away (`totals`, `by_time`,
 * `arm_totals`, `daily_trend`) a fixed-arity `<slug>_0..<slug>_{slots-1}`
 * parameter — see `compose/datasets.mjs`'s `## Filters` for the full
 * contract. The runtime never sees the composed manifest (only
 * `window.__DATA_APP_SPEC`), so `slug`/`slotsOf` below are ported verbatim
 * from the composer: a spec's queries and its FilterBar must agree on both
 * without either side reading the other's output.
 *
 * `by_dimension`, `by_time_<dim>` and `segments` are not filtered by the
 * query (they select the dimension away, not out) — `filterRows` narrows
 * those in memory instead.
 */

import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { AppliedState, DropReason, DroppedParam, RenderState, Scalar } from './studio/types.js'
import { reportState } from './studio/contextRegistry.js'
import { renderState } from './studio/hostState.js'
import { control, filterControls, type FilterControl, type Spec, type TimePreset } from './spec.js'

/** One filter control's current picks, keyed by the dimension it narrows. */
export type FiltersState = Readonly<Record<string, readonly string[]>>

export type TimeRange = { readonly from: string; readonly to: string }
export type TimeState = TimeRange & { readonly preset?: TimePreset }

/** Mirrors `compose/datasets.mjs`'s `slug` — the two must agree on parameter names. */
export function slug(field: string): string {
  return field.toLowerCase().replace(/[^a-z0-9_]/g, '_')
}

const MAX_SLOTS = 5

function toStrings(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).map((item) => String(item))
}

/** The values a filter starts from: its `default`, or all of its `options` when it has none. */
export function seedOf(filterControl: FilterControl): string[] {
  if (filterControl.default !== undefined) return toStrings(filterControl.default)
  return (filterControl.options ?? []).map((value) => String(value))
}

/**
 * Mirrors `compose/datasets.mjs`'s `slotsOf` exactly: a single-select filter
 * is always 1 slot; a multi filter is `options.length` capped at
 * `MAX_SLOTS`, or `slots` when the control overrides it. `seed` is the
 * fallback when the control has no `options` yet.
 */
export function slotsOf(filterControl: FilterControl, seed: readonly string[]): number {
  if (filterControl.multi !== true) return 1
  const fromOptions = Math.min((filterControl.options ?? []).length, MAX_SLOTS)
  const fallback = fromOptions === 0 ? Math.min(seed.length, MAX_SLOTS) : fromOptions
  return Math.min(MAX_SLOTS, Math.max(1, filterControl.slots ?? fallback))
}

/** Every filter's initial selection — the control default, or all of its options. */
export function initialFilters(spec: Spec): FiltersState {
  const state: Record<string, readonly string[]> = {}
  for (const filterControl of filterControls(spec)) state[filterControl.dim] = seedOf(filterControl)
  return state
}

function padded(values: readonly string[], slots: number): string[] {
  return Array.from({ length: slots }, (_, index) => values[Math.min(index, values.length - 1)] ?? '')
}

/**
 * The `<slug>_i` parameters every filtered dataset (`totals`, `by_time`,
 * `arm_totals`, `daily_trend`) needs, built from the current selection, plus
 * which dims could not be expressed in their fixed slot count.
 *
 * Fewer picks than slots repeats the last pick — `IN` is a set, so a repeat
 * is a no-op (verified by running the query in compose/datasets.mjs's `##
 * Filters`). More picks than slots cannot be expressed at all: the query
 * falls back to the control's full `options` list (its "everything" state)
 * and the caller is told which dim did that, so the FilterBar can say so.
 */
export function buildFilterParams(spec: Spec, filters: FiltersState): { readonly params: Readonly<Record<string, Scalar>>; readonly overflow: Readonly<Record<string, boolean>> } {
  const params: Record<string, Scalar> = {}
  const overflow: Record<string, boolean> = {}
  for (const filterControl of filterControls(spec)) {
    const seed = seedOf(filterControl)
    const slots = slotsOf(filterControl, seed)
    const selected = filters[filterControl.dim] ?? seed
    const over = selected.length > slots
    overflow[filterControl.dim] = over
    const source = over ? (filterControl.options ?? seed).map((value) => String(value)) : selected
    const values = padded(source, slots)
    const prefix = slug(filterControl.dim)
    values.forEach((value, index) => {
      params[`${prefix}_${index}`] = value
    })
  }
  return { params, overflow }
}

/** `from`/`to` plus `entity` (when the spec has one and the viewer picked it) — every declared query's baseline. */
export function baseParams(spec: Spec, time: TimeRange, entityId: string | undefined): Record<string, Scalar> {
  const base: Record<string, Scalar> = { from: time.from, to: time.to }
  if (spec.entity !== undefined && entityId !== undefined) base.entity = (spec.entity.type ?? 'number') === 'number' ? Number(entityId) : entityId
  return base
}

/**
 * Rows a query did not filter (`by_dimension`, `by_time_<dim>`, `segments`)
 * narrowed client-side by exact match. One filter at a time: a dataset
 * missing a filtered dim's column (a per-dim trend query only carries its
 * own dim) is simply not narrowed by that filter rather than dropped
 * entirely.
 */
export function filterRows<T extends Record<string, unknown>>(rows: readonly T[], filters: FiltersState): T[] {
  const active = Object.entries(filters).filter(([, values]) => values.length > 0)
  if (active.length === 0) return [...rows]
  return rows.filter((row) =>
    active.every(([dim, values]) => {
      if (!(dim in row)) return true
      return values.includes(String(row[dim]))
    }),
  )
}

/* ---------------------------------------------------------------- time */

const DAY_MS = 86_400_000
const isoDate = (date: Date) => date.toISOString().slice(0, 10)

/**
 * `spec.time.to`, resolved against `now` rather than the real clock — unlike
 * `spec.ts`'s `resolveTo`, this takes `now` as a parameter so every date this
 * module derives from it (including this one) is reproducible in a test with
 * a fixed `now`, and identical to `resolveTo` in production, where `now`
 * defaults to the real current time.
 */
function resolveToNow(to: string, now: Date): string {
  return to === 'tomorrow' ? isoDate(new Date(now.getTime() + DAY_MS)) : to
}

/**
 * A preset resolved against `now` (injectable for tests). `7d`/`30d`/`90d`
 * end at the spec's own `to` (so a spec fixed to a past window stays
 * self-consistent); `quarter`/`ytd` are genuinely "to date" — anchored on
 * the viewer's clock, not the spec's.
 *
 * With an `asOf` (E9 contract 5) the preset is computed relative to it
 * instead: every preset's window ends AT the as-of day — `30d` is the 30
 * days up to it, `quarter`/`ytd` are "to date" as of that day. Clamping a
 * preset resolved against today would collapse it to a single day once the
 * link is older than the window (`t=30d&asof=2026-06-01` opened in
 * September would read 2026-06-01..2026-06-01).
 */
export function presetRange(preset: TimePreset, spec: Spec, now: Date = new Date(), asOf?: string): TimeRange {
  if (asOf !== undefined) now = new Date(`${asOf}T00:00:00Z`)
  switch (preset) {
    case '7d':
    case '30d':
    case '90d': {
      const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90
      const to = asOf ?? resolveToNow(spec.time.to, now)
      const from = isoDate(new Date(new Date(`${to}T00:00:00Z`).getTime() - days * DAY_MS))
      return { from, to }
    }
    case 'quarter': {
      const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3
      return { from: isoDate(new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1))), to: isoDate(now) }
    }
    case 'ytd':
      return { from: isoDate(new Date(Date.UTC(now.getUTCFullYear(), 0, 1))), to: isoDate(now) }
  }
}

/** The `time` control's declared presets, or the three short ones when it names none. */
export function timePresets(spec: Spec): readonly TimePreset[] {
  return control(spec, 'time')?.presets ?? ['7d', '30d', '90d']
}

/**
 * The starting time state: the `time` control's default preset resolved, or
 * the spec's own range. With an `asOf`, the default preset is computed
 * relative to it (contract 5) and the spec's own range is clamped to it.
 */
export function initialTime(spec: Spec, now: Date = new Date(), asOf?: string): TimeState {
  const preset = control(spec, 'time')?.default as TimePreset | undefined
  if (preset === undefined) return clampToAsOf({ from: spec.time.from, to: resolveToNow(spec.time.to, now) }, asOf)
  return { ...presetRange(preset, spec, now, asOf), preset }
}

/* --------------------------------------------- host state (T9.0, deep link) */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * An ISO date's day part, or `undefined` when the value is not a real
 * calendar date. Validated by round-trip: `Date` quietly rolls an impossible
 * day over (`2026-02-31` parses as 2026-03-03), so the parsed date must
 * print back as exactly the day it was given.
 */
export function isoDay(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const day = value.slice(0, 10)
  if (!ISO_DATE.test(day)) return undefined
  const parsed = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return undefined
  return day
}

/**
 * The window an as-of pins an EXPLICIT range to: the same range, never
 * reaching past the as-of date. Presets are not clamped — they are computed
 * relative to the as-of in the first place (`presetRange`'s `asOf`). This is how `asOf` reaches the queries — the composer declares
 * `:from`/`:to` and nothing else, so an extra `as_of` parameter would be
 * refused (`missing_param`'s mirror image); clamping the declared upper
 * bound pins every query the app issues, including the ones a control
 * changes later, and the FilterBar shows the clamped range rather than a
 * range the data does not cover.
 */
export function clampToAsOf(time: TimeState, asOf: string | undefined): TimeState {
  if (asOf === undefined) return time
  const to = time.to > asOf ? asOf : time.to
  const from = time.from > asOf ? asOf : time.from
  return from === time.from && to === time.to ? time : { ...time, from, to }
}

/** The app's own defaults, with the as-of folded in: what "untouched" means (E9 contract 6). */
export type ControlDefaults = { readonly filters: FiltersState; readonly time: TimeState }

/** Everything `applyRenderState` resolved, ready to seed `ControlsProvider`'s state. */
export type AppliedControls = {
  readonly filters: FiltersState
  readonly time: TimeState
  readonly asOf: string | undefined
  readonly section: string | undefined
  /** What the host asked for and the spec could not honour, deduped by `id` + `reason`. */
  readonly dropped: readonly DroppedParam[]
  /** What the state is compared against before it is reported. */
  readonly defaults: ControlDefaults
}

/**
 * The host's `state` checked against the spec (T9.0, contract 2).
 *
 * Pure, and called from `ControlsProvider`'s state initialisers, so the
 * FilterBar and the time controls are already on the host's values when the
 * first query is built — there is no "default window, then the real one"
 * pass, and no query is issued for a state nobody asked for.
 *
 * Anything the spec cannot honour is dropped rather than applied: an unknown
 * filter id, a value a filter does not offer, a preset the `time` control
 * does not declare, an unparseable date. Each one is named in `dropped`, and
 * that list travels to the host in `studio:sandbox:state` so a bad link says
 * so instead of quietly showing a different app.
 */
export function applyRenderState(spec: Spec, state: RenderState, now: Date = new Date()): AppliedControls {
  const dropped: DroppedParam[] = []
  const drop = (id: string, reason: DropReason): void => {
    if (!dropped.some((entry) => entry.id === id && entry.reason === reason)) dropped.push({ id, reason })
  }
  const byDim = new Map(filterControls(spec).map((filterControl) => [filterControl.dim, filterControl]))

  // Filters. The spec's own seed stays in place for every filter the host
  // did not name, and for one whose values were all dropped.
  const filters: Record<string, readonly string[]> = { ...initialFilters(spec) }
  for (const [id, raw] of Object.entries(state.filters ?? {})) {
    const filterControl = byDim.get(id)
    if (filterControl === undefined) {
      drop(`f.${id}`, 'unknown_filter')
      continue
    }
    const allowed = (filterControl.options ?? []).map((value) => String(value))
    const wanted = (Array.isArray(raw) ? raw : []).map((value) => String(value))
    const kept: string[] = []
    for (const value of wanted) {
      // A value the filter does not offer, or a second value for a
      // single-select filter: both are values this filter cannot take.
      if (allowed.length > 0 && !allowed.includes(value)) drop(`f.${id}`, 'invalid_value')
      else if (filterControl.multi !== true && kept.length === 1) drop(`f.${id}`, 'invalid_value')
      else kept.push(value)
    }
    if (kept.length > 0) filters[id] = kept
  }

  // asOf first: every preset below is computed relative to it.
  let asOf: string | undefined
  if (state.asOf !== undefined) {
    asOf = isoDay(state.asOf)
    if (asOf === undefined) drop('asof', 'invalid_date')
  }

  // Time: a declared preset wins; an explicit ISO range is the fallback.
  // Only an explicit range is clamped to the as-of (contract 5).
  const defaultTime = initialTime(spec, now, asOf)
  let time = defaultTime
  const wantedTime = state.time
  if (wantedTime !== undefined) {
    const declared = timePresets(spec)
    const preset = wantedTime.preset
    const from = isoDay(wantedTime.from)
    const to = isoDay(wantedTime.to)
    if (preset !== undefined && declared.includes(preset as TimePreset)) {
      time = { ...presetRange(preset as TimePreset, spec, now, asOf), preset: preset as TimePreset }
    } else {
      if (preset !== undefined) drop('t', 'undeclared_preset')
      if (from !== undefined && to !== undefined) time = clampToAsOf({ from, to }, asOf)
      else if (wantedTime.from !== undefined || wantedTime.to !== undefined) drop('t', 'invalid_date')
    }
  }

  // `section` is carried, not checked: this kit's spec declares no sections
  // yet (see README's protocol table), so there is nothing to check it
  // against and nothing that renders it — it round-trips so a host that does
  // declare them keeps its link intact.
  const section = typeof state.section === 'string' && state.section.length > 0 ? state.section : undefined

  return { filters, time, asOf, section, dropped, defaults: { filters: initialFilters(spec), time: defaultTime } }
}

/** Same picks, order aside — a filter is a set. */
function sameValues(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const set = new Set(left)
  return right.every((value) => set.has(value)) && new Set(right).size === set.size
}

/**
 * The default window, per contract 6: the same preset, or — when neither
 * side is a preset — the same explicit range. An explicit range that merely
 * happens to equal today's resolution of the default preset is NOT the
 * default: it stays fixed while the preset moves with the clock.
 */
function sameWindow(time: TimeState, defaults: TimeState): boolean {
  if (time.preset !== undefined || defaults.preset !== undefined) return time.preset === defaults.preset
  return time.from === defaults.from && time.to === defaults.to
}

/**
 * The controls state as the `studio:sandbox:state` message carries it — only
 * what differs from the app's defaults (E9 contract 6), so an untouched view
 * reports `{ filters: {} }` and the host keeps its URL bare. A filter equal
 * to its seed is omitted; `time` is omitted when it is the default window.
 * `asOf` and `section` are never defaults, so they appear whenever set.
 */
export function appliedState(
  current: { readonly filters: FiltersState; readonly time: TimeState; readonly asOf: string | undefined; readonly section: string | undefined },
  defaults: ControlDefaults,
): AppliedState {
  const { filters, time, asOf, section } = current
  const changed: Record<string, readonly string[]> = {}
  for (const [dim, values] of Object.entries(filters)) {
    const seed = defaults.filters[dim]
    if (seed === undefined || !sameValues(values, seed)) changed[dim] = values
  }
  return {
    ...(asOf === undefined ? {} : { asOf }),
    ...(sameWindow(time, defaults.time) ? {} : { time: { ...(time.preset === undefined ? {} : { preset: time.preset }), from: time.from, to: time.to } }),
    filters: changed,
    ...(section === undefined ? {} : { section }),
  }
}

/* ------------------------------------------------------------- provider */

export type ControlsState = {
  readonly filters: FiltersState
  readonly time: TimeState
  /** The as-of the host pinned, if any. Already folded into `time`; exposed so a card can say what it is showing. */
  readonly asOf: string | undefined
  /** The section/tab the host asked for, if any. Carried, not rendered — this kit's spec declares no sections. */
  readonly section: string | undefined
}

export type ControlsActions = {
  /** Multi filter: add/remove one value. Dropping the last one falls back to "All" rather than leaving nothing selected. */
  toggleFilterValue(dim: string, value: string): void
  /** Single-select filter: replace the pick outright. */
  setFilterValue(dim: string, value: string): void
  /** The "All" chip: reset a filter to every option. */
  resetFilter(dim: string): void
  setPreset(preset: TimePreset): void
  /** Move to another section/tab. Reported to the host like any other change. */
  setSection(section: string | undefined): void
}

const ControlsContext = createContext<(ControlsState & ControlsActions) | undefined>(undefined)

export function ControlsProvider({ spec, children }: { spec: Spec; children: ReactNode }) {
  // Resolved once, before the first render of any child, so the first query
  // this app issues already carries the host's filters and its pinned as-of.
  const seed = useRef<AppliedControls | undefined>(undefined)
  if (seed.current === undefined) seed.current = applyRenderState(spec, renderState())
  const applied = seed.current

  const [filters, setFilters] = useState<FiltersState>(applied.filters)
  const [time, setTime] = useState<TimeState>(applied.time)
  const [section, setSection] = useState<string | undefined>(applied.section)
  const asOf = applied.asOf

  // Contract 3: once after the initial state is applied, then on every
  // change a person makes. Always sent — `filters: {}` when everything is
  // the default — so the host knows the state was applied; only what
  // differs from the defaults is in it. `dropped` describes the initial
  // state and does not change, so every message repeats it rather than the
  // host having to remember the first one.
  useEffect(() => {
    reportState(appliedState({ filters, time, asOf, section }, applied.defaults), applied.dropped)
  }, [filters, time, asOf, section, applied])

  const controlsByDim = useMemo(() => {
    const map = new Map<string, FilterControl>()
    for (const filterControl of filterControls(spec)) map.set(filterControl.dim, filterControl)
    return map
  }, [spec])

  const optionsOf = (dim: string): string[] => {
    const filterControl = controlsByDim.get(dim)
    if (filterControl === undefined) return []
    return (filterControl.options ?? seedOf(filterControl)).map((value) => String(value))
  }

  const value = useMemo<ControlsState & ControlsActions>(
    () => ({
      filters,
      time,
      asOf,
      section,
      toggleFilterValue: (dim, val) => {
        setFilters((current) => {
          const options = optionsOf(dim)
          const selected = current[dim] ?? options
          if (controlsByDim.get(dim)?.multi !== true) return { ...current, [dim]: [val] }
          const next = selected.includes(val) ? selected.filter((picked) => picked !== val) : [...selected, val]
          return { ...current, [dim]: next.length === 0 ? options : next }
        })
      },
      setFilterValue: (dim, val) => setFilters((current) => ({ ...current, [dim]: [val] })),
      resetFilter: (dim) => setFilters((current) => ({ ...current, [dim]: optionsOf(dim) })),
      // The as-of the host pinned outlives a preset change: a viewer widening
      // the window still never sees past the date the link was cut at, and
      // the new preset is computed relative to it (ends at the as-of) rather
      // than resolved against today and clamped down to one day.
      setPreset: (preset) => setTime({ ...presetRange(preset, spec, new Date(), asOf), preset }),
      setSection,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters, time, asOf, section, controlsByDim, spec],
  )

  return <ControlsContext.Provider value={value}>{children}</ControlsContext.Provider>
}

/** `useControls()` that reads `undefined` outside a provider instead of throwing — for a card that can work from the spec's own window (a recipe rendered on its own, in a fixture). */
export function useControlsIfAny(): (ControlsState & ControlsActions) | undefined {
  return useContext(ControlsContext)
}

export function useControls(): ControlsState & ControlsActions {
  const value = useContext(ControlsContext)
  if (value === undefined) throw new Error('useControls outside ControlsProvider')
  return value
}
