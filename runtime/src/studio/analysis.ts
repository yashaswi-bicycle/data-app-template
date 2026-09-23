/**
 * Declared analyses, run as the viewer (Detect & Explain, bicycle-studio-api
 * `POST /data-apps/{appId}/analyses/{analysisId}/run`).
 *
 * An analysis is a job, not a query: it is queued per tenant, runs for
 * seconds to minutes, and ends `succeeded`, `failed` or `cancelled`. The host
 * owns the waiting — exactly as it owns the summary's — so the frame asks once
 * and is told every time the job moves:
 *
 *   -> { type: 'studio:sandbox:analysis', requestId, action: 'run', analysisId, window?, baselineWindow?, filters? }
 *   <- { type: 'studio:sandbox:analysis-result', requestId, ok, job?, result?, error?, final }   (repeated)
 *   -> { type: 'studio:sandbox:analysis', requestId, action: 'unwatch' }                         (stop telling me)
 *   -> { type: 'studio:sandbox:analysis', requestId, action: 'cancel', jobId }                   (abandon the job)
 *
 * `job` is the service's `JobStatus`, `result` its `AnalysisResult` (findings
 * and drivers, keyed by `finding_key`), sent once with `final: true` when the
 * job succeeded. `appId` never travels: the host uses its own.
 *
 * `unwatch` is not `cancel`. A panel that unmounts or re-runs with new filters
 * stops listening; the job itself carries on and a later run with the same
 * question attaches to it (`attached: true`) rather than spending again.
 * `cancel` is the viewer saying "stop", which the service treats as
 * abandoning the answer.
 */

import { context } from './context.js'
import { BdaError } from './types.js'

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type AnalysisWindow = { readonly from: string; readonly through: string } | { readonly relative: string }

export type AnalysisFilter = { readonly field: string; readonly op: string; readonly value: unknown }

export type JobError = { readonly code: string; readonly message: string; readonly retryable?: boolean; readonly retry_after_s?: number | null }

/** The service's `JobStatus` (DE contract §4.1) — only what the panel reads is typed. */
export type AnalysisJob = {
  readonly job_id: string
  readonly analysis_id?: string | null
  readonly kind?: 'detect' | 'explain'
  readonly mode?: string
  readonly kpi_name?: string
  readonly dimensions?: readonly string[]
  readonly state: JobState
  readonly position?: number | null
  readonly attempt?: number
  readonly created_at?: string
  readonly started_at?: string | null
  readonly finished_at?: string | null
  readonly elapsed_s?: number | null
  readonly windows?: Readonly<Record<string, unknown>> | null
  readonly notices?: readonly { readonly code: string; readonly message: string }[]
  readonly warnings?: readonly { readonly code: string; readonly message: string }[]
  readonly error?: JobError | null
  readonly counts?: { readonly findings: number; readonly drivers: number; readonly cells: number } | null
  readonly cached?: boolean
  readonly attached?: boolean
}

/** One `bicycle.findings/v1` row. Every key is always present, `null` when unknown. */
export type Finding = {
  readonly finding_key: string
  readonly question_key?: string | null
  readonly kpi_name: string | null
  readonly segment_key: string
  readonly dimensions: Readonly<Record<string, unknown>>
  readonly level?: number | null
  readonly disposition?: string | null
  readonly current_value: number | null
  readonly baseline_value: number | null
  readonly band_low?: number | null
  readonly band_high?: number | null
  readonly delta: number | null
  readonly pct_change: number | null
  readonly global_contribution_pct?: number | null
  readonly severity: 'critical' | 'high' | 'medium' | 'low' | null
  readonly drivers_count?: number | null
  readonly window_start: string | null
  readonly window_end: string | null
  readonly baseline_start?: string | null
  readonly baseline_end?: string | null
}

/** One `bicycle.drivers/v1` row, under its finding. */
export type Driver = {
  readonly driver_key: string
  readonly finding_key: string
  readonly segment_key: string
  readonly dimensions: Readonly<Record<string, unknown>>
  readonly current_value: number | null
  readonly baseline_value: number | null
  readonly delta: number | null
  readonly pct_change: number | null
  readonly parent_contribution_pct: number | null
  readonly global_contribution_pct?: number | null
  readonly rank: number | null
}

/** The service's `AnalysisResult` (DE contract §4.2). */
export type AnalysisResult = {
  readonly job_id: string
  readonly state: JobState
  readonly kind?: string
  readonly mode?: string
  readonly findings: readonly Finding[]
  readonly drivers: readonly Driver[]
  readonly truncated?: { readonly findings?: boolean; readonly drivers?: boolean }
  readonly notices?: readonly { readonly code: string; readonly message: string }[]
  readonly warnings?: readonly { readonly code: string; readonly message: string }[]
  readonly summary?: { readonly status?: string; readonly message?: string | null } | null
}

/** What the viewer is told, in five words. `cancelled` and the service's `analysis_abandoned` both read as `abandoned`. */
export type AnalysisPhase = 'queued' | 'running' | 'done' | 'failed' | 'abandoned'

export function phaseOf(job: AnalysisJob | undefined, error?: { readonly code: string } | undefined): AnalysisPhase {
  if (error?.code === 'analysis_abandoned' || job?.error?.code === 'analysis_abandoned' || job?.state === 'cancelled') return 'abandoned'
  if (error !== undefined) return 'failed'
  switch (job?.state) {
    case 'succeeded':
      return 'done'
    case 'failed':
      return 'failed'
    case 'running':
      return 'running'
    default:
      return 'queued'
  }
}

export type AnalysisUpdate = {
  readonly job?: AnalysisJob
  readonly result?: AnalysisResult
  readonly error?: BdaError
  /** Nothing more will come for this run. */
  readonly final: boolean
}

export type RunBody = {
  readonly window?: AnalysisWindow
  readonly baselineWindow?: { readonly shift: string } | AnalysisWindow
  readonly filters?: readonly AnalysisFilter[]
}

const HOST_ANALYSIS = 'studio:sandbox:analysis'
const HOST_ANALYSIS_RESULT = 'studio:sandbox:analysis-result'
let nextRequestId = 0

type HostReply = {
  type?: string
  requestId?: string
  ok?: boolean
  job?: AnalysisJob
  result?: AnalysisResult
  error?: { code?: string; message?: string; status?: number }
  final?: boolean
}

function viaHost(analysisId: string, body: RunBody, onUpdate: (update: AnalysisUpdate) => void): () => void {
  const requestId = `a${(nextRequestId += 1)}`
  let done = false
  const stop = () => {
    if (done) return
    done = true
    window.removeEventListener('message', onMessage)
  }
  const onMessage = (event: MessageEvent<HostReply>) => {
    const reply = event.data
    if (reply?.type !== HOST_ANALYSIS_RESULT || reply.requestId !== requestId) return
    const final = reply.final === true || reply.ok !== true
    if (reply.ok === true) {
      onUpdate({ ...(reply.job === undefined ? {} : { job: reply.job }), ...(reply.result === undefined ? {} : { result: reply.result }), final })
    } else {
      const error = reply.error ?? {}
      onUpdate({ ...(reply.job === undefined ? {} : { job: reply.job }), error: new BdaError(error.code ?? 'request_failed', error.message ?? 'The host could not run this analysis.', error.status ?? 0), final: true })
    }
    if (final) stop()
  }
  window.addEventListener('message', onMessage)
  window.parent.postMessage({ type: HOST_ANALYSIS, requestId, action: 'run', analysisId, ...body }, '*')
  return () => {
    if (done) return
    stop()
    window.parent.postMessage({ type: HOST_ANALYSIS, requestId, action: 'unwatch' }, '*')
  }
}

async function toError(response: Response): Promise<BdaError> {
  let code = 'request_failed'
  let message = `The request failed with status ${response.status}.`
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } }
    if (typeof body.error?.code === 'string') code = body.error.code
    if (typeof body.error?.message === 'string') message = body.error.message
  } catch {
    // non-JSON body
  }
  return new BdaError(code, message, response.status)
}

/**
 * Development only: the same conversation against the API directly — run,
 * then long-poll the job (`wait_s=20`) until it is final, then read the
 * result. Framed, the host does all of this and the frame never fetches.
 */
function direct(analysisId: string, body: RunBody, onUpdate: (update: AnalysisUpdate) => void): () => void {
  const controller = new AbortController()
  const run = async () => {
    const { apiBase, appId, token } = context()
    const base = `${apiBase}/data-apps/${encodeURIComponent(appId)}`
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const payload = { ...(body.window === undefined ? {} : { window: body.window }), ...(body.baselineWindow === undefined ? {} : { baseline_window: body.baselineWindow }), ...(body.filters === undefined ? {} : { filters: body.filters }) }
    const started = await fetch(`${base}/analyses/${encodeURIComponent(analysisId)}/run`, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal })
    if (!started.ok) throw await toError(started)
    let job = (await started.json()) as AnalysisJob
    onUpdate({ job, final: false })
    while (job.state === 'queued' || job.state === 'running') {
      const polled = await fetch(`${base}/analysis-jobs/${encodeURIComponent(job.job_id)}?wait_s=20`, { headers, signal: controller.signal })
      if (!polled.ok) throw await toError(polled)
      const next = (await polled.json()) as AnalysisJob
      if (next.state !== job.state || next.position !== job.position) onUpdate({ job: next, final: false })
      job = next
    }
    if (job.state !== 'succeeded') {
      onUpdate({ job, final: true })
      return
    }
    const result = await fetch(`${base}/analysis-jobs/${encodeURIComponent(job.job_id)}/result`, { headers, signal: controller.signal })
    if (!result.ok) throw await toError(result)
    onUpdate({ job, result: (await result.json()) as AnalysisResult, final: true })
  }
  run().catch((error: unknown) => {
    if (controller.signal.aborted) return
    onUpdate({ error: error instanceof BdaError ? error : new BdaError('network_error', (error as Error)?.message ?? 'The analysis request failed.', 0), final: true })
  })
  return () => controller.abort()
}

/**
 * Run a declared analysis and be told about it until it is final. Returns a
 * function that stops listening (it does not cancel the job — see the header).
 */
export function watchAnalysis(analysisId: string, body: RunBody, onUpdate: (update: AnalysisUpdate) => void): () => void {
  return window.parent !== window ? viaHost(analysisId, body, onUpdate) : direct(analysisId, body, onUpdate)
}

/** Abandon a job the viewer no longer wants. Fire-and-forget framed; the watcher hears the `cancelled` state. */
export function cancelAnalysis(jobId: string): void {
  if (window.parent !== window) {
    window.parent.postMessage({ type: HOST_ANALYSIS, requestId: `a${(nextRequestId += 1)}`, action: 'cancel', jobId }, '*')
    return
  }
  const { apiBase, appId, token } = context()
  void fetch(`${apiBase}/data-apps/${encodeURIComponent(appId)}/analysis-jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {})
}

/* ---------------------------------------------------------------- binding */

const DAY_MS = 86_400_000

/**
 * The panel's `[from, to)` range as the service's inclusive `{from, through}`.
 * `undefined` when the range holds no whole day.
 */
export function windowOf(time: { readonly from: string; readonly to: string }): AnalysisWindow | undefined {
  const end = Date.parse(`${time.to}T00:00:00Z`)
  if (Number.isNaN(end)) return undefined
  const through = new Date(end - DAY_MS).toISOString().slice(0, 10)
  return through < time.from ? undefined : { from: time.from, through }
}

/**
 * The FilterBar's picks as the service's filter grammar: one `in` per filter
 * that is actually narrowed (a filter showing every option is no filter), at
 * most 20 values each and 8 filters in all — the service's own caps.
 */
export function filtersOf(filters: Readonly<Record<string, readonly string[]>>, optionsOf: (dim: string) => readonly string[]): AnalysisFilter[] {
  const out: AnalysisFilter[] = []
  for (const [field, picked] of Object.entries(filters)) {
    const options = optionsOf(field)
    const narrowed = picked.length > 0 && (options.length === 0 || picked.length < options.length || picked.some((value) => !options.includes(value)))
    if (!narrowed || picked.length > 20) continue
    out.push({ field, op: 'in', value: [...picked] })
  }
  return out.slice(0, 8)
}
