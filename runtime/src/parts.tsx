/** Small shared pieces every recipe reaches for. */

import type { CSSProperties, ReactNode } from 'react'
import type { Confidence, VariantOverall } from './analysis.js'
import { Provenance, type ProvenanceSpec } from './chrome/Provenance.js'
import { SkeletonChart, SkeletonMetric, SkeletonTable, SkeletonText } from './components/Skeleton.js'
import type { CoreData, Dataset, QueryState } from './data.js'
import { fmtSigned } from './format.js'
import type { MetricOrCvr, Spec } from './spec.js'
import { type FindingReport, usePanelMeta, useRegisterPanelInstance } from './studio/contextRegistry.js'
import type { BdaError, PanelStatus } from './studio/types.js'

export const METRIC_COLOR: Record<MetricOrCvr, string> = {
  NIBPD: 'var(--bda-chart-1)',
  NIBrPD: 'var(--bda-chart-2)',
  NICPD: 'var(--bda-chart-3)',
  CVR: 'var(--bda-chart-4)',
}

export const METRIC_TITLE: Record<MetricOrCvr, string> = {
  NIBPD: 'Net Incremental Bookings per Day',
  NIBrPD: 'Net Incremental Bookers per Day',
  NICPD: 'Net Incremental Commerce per Day',
  CVR: 'Conversion Rate',
}

/** A stable series colour per core measure: its position in the spec. */
export function measureColor(spec: Spec, measureId: string): string {
  const index = spec.measures.findIndex((measure) => measure.id === measureId)
  return `var(--bda-chart-${(Math.max(index, 0) % 6) + 1})`
}

export const BADGE_COLOR: Record<Confidence, string> = {
  '99%': 'var(--bda-positive)',
  '95%': 'var(--bda-chart-3)',
  '90%': 'var(--bda-chart-1)',
  '80%': 'var(--bda-chart-4)',
  '<80%': 'var(--bda-text-secondary)',
  'N/A': 'var(--bda-text-secondary)',
}

/** ab_test recipes. */
export type RecipeProps = {
  readonly spec: Spec
  readonly data: Dataset
  readonly bind: Readonly<Record<string, unknown>>
}

/** Core recipes. */
export type CoreProps = {
  readonly spec: Spec
  readonly core: CoreData
  readonly bind: Readonly<Record<string, unknown>>
}

export function Badge({ confidence, z }: { confidence: Confidence; z: number }) {
  const color = BADGE_COLOR[confidence]
  return (
    <span className="kit-badge" style={{ color, background: `color-mix(in srgb, ${color} 18%, transparent)` }}>
      {confidence === 'N/A' ? 'N/A' : `${confidence} (z=${z.toFixed(2)})`}
    </span>
  )
}

export function Signed({ value, currency }: { value: number | null; currency?: boolean }) {
  if (value === null) return <>{'—'}</>
  return <span style={{ color: value >= 0 ? 'var(--bda-positive)' : 'var(--bda-negative)' }}>{fmtSigned(value, currency === true)}</span>
}

export function Legend({ items }: { items: readonly { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="kit-legend">
      {items.map((item) => (
        <span key={item.label} className="kit-legend__item">
          <span className={`kit-legend__swatch${item.dashed === true ? ' kit-legend__swatch--dashed' : ''}`} style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  )
}

export function SectionHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="kit-sh kit-sh--row">
      <span>{title}</span>
      {right}
    </div>
  )
}

export function Card({ label, value, hint, tone, small }: { label: string; value: string; hint?: ReactNode; tone?: 'positive' | 'negative' | 'warn' | 'cvr' | 'accent'; small?: boolean }) {
  const color =
    tone === 'positive' ? 'var(--bda-positive)' : tone === 'negative' ? 'var(--bda-negative)' : tone === 'warn' || tone === 'cvr' ? 'var(--bda-chart-4)' : tone === 'accent' ? 'var(--bda-chart-1)' : undefined
  return (
    <div className="kit-card">
      <span className="kit-card__label">{label}</span>
      <span className={`kit-card__value${small === true ? ' kit-card__value--small' : ''}`} style={color === undefined ? undefined : { color }}>
        {value}
      </span>
      {hint === undefined ? null : <span className="kit-card__hint">{hint}</span>}
    </div>
  )
}

export function statusTone(status: string): 'positive' | 'negative' | 'warn' {
  const upper = status.toUpperCase()
  return upper.includes('WIN') ? 'positive' : upper.includes('LOSE') ? 'negative' : 'warn'
}

export function trafficSplit(overall: readonly VariantOverall[], control: string): string {
  const first = overall[0]
  if (first === undefined) return '—'
  const total = first.participantsTotal
  const pct = (count: number) => (total > 0 ? `${((count / total) * 100).toFixed(2).replace(/\.00$/, '')}%` : '—')
  const parts = [`${pct(first.participantsDefault)} (${control})`, ...overall.map((variant) => `${pct(variant.participants)} (${variant.name})`)]
  return parts.join(' | ')
}

/**
 * The shape a skeleton should take while a widget's own query is pending —
 * sized to the content it stands in for, per AGENTS.md's "Widgets never
 * blank" invariant.
 */
export type SkeletonSpec = { readonly kind: 'chart'; readonly height: number } | { readonly kind: 'metric' } | { readonly kind: 'table'; readonly rows: number } | { readonly kind: 'text'; readonly lines?: number }

function SkeletonFor({ spec }: { spec: SkeletonSpec }) {
  switch (spec.kind) {
    case 'chart':
      return <SkeletonChart height={spec.height} />
    case 'metric':
      return <SkeletonMetric />
    case 'table':
      return <SkeletonTable rows={spec.rows} />
    case 'text':
      return <SkeletonText {...(spec.lines === undefined ? {} : { lines: spec.lines })} />
  }
}

/** What failed, and a way to try again without reloading the rest of the app. */
export function WidgetError({ error, onRetry }: { error: BdaError; onRetry: () => void }) {
  return (
    <div className="kit-widget-error" role="alert">
      <span className="kit-widget-error__code">{error.code}</span>
      <span>{error.message}</span>
      <button type="button" className="kit-widget-error__retry" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}

export type WidgetProps = {
  /** Always rendered, pending or not — the reader sees what is coming while it loads. */
  readonly heading: ReactNode
  readonly pending: boolean
  /** A background refetch (a control changed) while previous rows stay on screen. */
  readonly fetching?: boolean
  readonly error?: BdaError | null
  readonly onRetry?: () => void
  readonly skeleton: SkeletonSpec
  /** Defaults to the standard card. Pass a section's own class for widgets that render outside `.bda-card` (verdict banners, the hypothesis quote). */
  readonly className?: string
  readonly style?: CSSProperties
  /**
   * What this card is showing, for the host's context reporter — the top
   * rows, the last few points, the current values, whatever is cheap and
   * ≤ 2 KB. Omit when the widget has nothing worth summarising (a verdict
   * banner, a findings list); the panel is still reported, just without a
   * `digest`. See `studio/contextRegistry.ts`.
   */
  readonly digest?: unknown
  /** The spec, when this card wants a "How is this computed?" affordance — pair with `provenance`. */
  readonly spec?: Spec
  /** What to show in the provenance popover. Omit (with `spec`) for a card with nothing worth explaining; both must be present for the affordance to render. */
  readonly provenance?: ProvenanceSpec
  /**
   * What kind of panel this is, beyond its `recipe` id, and the chat thread
   * its own answer came from — reported to the host's context message
   * (`contextRegistry.ts`'s `PanelReport.kind`/`threadId`) so its ask
   * overlay can continue that thread. Only the `summary` recipe (T5.4)
   * passes these today; every other recipe leaves them unset.
   */
  readonly kind?: string | undefined
  readonly threadId?: string | undefined
  /**
   * This card resolved with nothing to show (T9.0, contract 1) — the rows
   * came back and there were none. Only changes what the panel *reports*
   * (`empty` rather than `ready`); what the card renders is the recipe's own
   * "No data." note, exactly as before. Recipes that already know their row
   * count pass it; one that cannot say cheaply leaves it unset and reports
   * `ready`, which is the safer default (a host waits for nothing).
   */
  readonly empty?: boolean
  /** The findings this card shows, for the host's "Why?" pill (`PanelReport.findings`). Only `changes` passes these. */
  readonly findings?: readonly FindingReport[] | undefined
  readonly children: ReactNode
}

/**
 * One card's readiness, from the same props that already decide what it
 * draws: a failed query first, then a pending one, then whether anything
 * came back. `fetching` deliberately does not count as `loading` — a
 * background refetch keeps the previous rows on screen (AGENTS.md, "Widgets
 * never blank"), so the panel is still showing something a host can read.
 */
export function widgetStatus({ pending, error = null, empty = false }: Pick<WidgetProps, 'pending' | 'error' | 'empty'>): PanelStatus {
  if (error !== null && error !== undefined) return 'error'
  if (pending) return 'loading'
  return empty ? 'empty' : 'ready'
}

/**
 * Wraps one widget's card: heading always on screen, `aria-busy` while its
 * own query is pending, a sized skeleton in place of content, a quiet
 * `kit-card--refreshing` state for a background refetch, and a per-widget
 * error with Retry. Every recipe routes its cards through this — see
 * AGENTS.md's "Widgets never blank" invariant.
 *
 * It also registers this card with the host's context reporter (invariant 9:
 * the runtime never renders the host's own UI, it only reports what is on
 * screen) — its `panelId` comes from `PanelMetaProvider` (App.tsx wraps every
 * resolved panel in one), so a recipe never has to know it exists.
 */
export function Widget({ heading, pending, fetching = false, error = null, onRetry, skeleton, className = 'bda-card', style, digest, spec, provenance, kind, threadId, empty, findings, children }: WidgetProps) {
  const refreshing = fetching && !pending
  const meta = usePanelMeta()
  const status = widgetStatus({ pending, error, ...(empty === undefined ? {} : { empty }) })
  const { nodeRef, highlighted } = useRegisterPanelInstance(meta, digest, status, { ...(kind === undefined ? {} : { kind }), ...(threadId === undefined ? {} : { threadId }), ...(findings === undefined ? {} : { findings }) })
  const classes = [className, refreshing ? 'kit-card--refreshing' : '', highlighted ? 'kit-card--highlight' : ''].filter((part) => part.length > 0).join(' ')
  const showProvenance = spec !== undefined && provenance !== undefined
  // The affordance is `position: absolute`, so this wrapper needs `position:
  // relative` — merged into `style` rather than a new class, since callers
  // pass many different `className`s (`bda-card`, `kit-kpi`, `kit-panel`…).
  const wrapperStyle = showProvenance ? { position: 'relative' as const, ...style } : style
  return (
    <div ref={nodeRef} className={classes} style={wrapperStyle} aria-busy={pending}>
      {showProvenance ? <Provenance spec={spec} provenance={provenance} panelId={meta?.panelId} /> : null}
      {heading}
      {error !== null ? <WidgetError error={error} onRetry={onRetry ?? (() => {})} /> : pending ? <SkeletonFor spec={skeleton} /> : children}
    </div>
  )
}

/**
 * `mergeQueries(...)` (or any single `QueryState`) collapsed to the props a
 * `Widget` needs.
 *
 * `rowCount` is what the card is actually about to draw — points on a chart,
 * rows in a table, cells in a heatmap — not the raw row count of the query
 * behind it. Passing it is what lets the panel report `empty` rather than
 * `ready` when everything resolved and there is nothing to show (T9.0);
 * leaving it off keeps the old behaviour.
 */
export function widgetState(merged: Pick<QueryState<unknown>, 'isPending' | 'isFetching' | 'error' | 'refetch'>, rowCount?: number): Pick<WidgetProps, 'pending' | 'fetching' | 'error' | 'onRetry' | 'empty'> {
  return { pending: merged.isPending, fetching: merged.isFetching, error: merged.error, onRetry: merged.refetch, ...(rowCount === undefined ? {} : { empty: rowCount === 0 }) }
}
