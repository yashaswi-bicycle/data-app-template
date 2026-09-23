/**
 * Agent runs about a finding (bicycle-studio-api `…/data-apps/{appId}/agent-runs`,
 * agent #1 is `cause`: "why did this change?").
 *
 * Same bargain as every other capability here: the frame asks, the host
 * calls the API as the viewer, and the host owns the waiting.
 *
 *   -> { type: 'studio:sandbox:agent-run', requestId, action: 'start' | 'get' | 'cancel' | 'feedback', agentId?,
 *        findingKey?, subjectKey?, jobId?, subject?, row?, question?, panelId?, filters?, input?, rerun?, runId?, verdict?,
 *        causeIds?, note? }
 *   <- { type: 'studio:sandbox:agent-run-result', requestId?, ok, findingKey, subjectKey, runId, state, match, asOf, run?, error? }
 *
 * The result is the answer to a request AND is pushed again, without a
 * `requestId`, every time the run moves while the host polls it — including
 * a run the viewer started from the host's own "Why?" pill, which the frame
 * never asked for. So a card listens by `findingKey`, not by request id
 * (`onAgentRunUpdate`), and a reload finds its run again with `get`.
 *
 * `state` is Studio's derived UI state (contract §3): `investigating`,
 * `explained`, `partial`, `unexplained`, `done`, `failed`, `rejected` (this
 * viewer said ✗), `stale` (the live row moved > 1 % since the run), or `none`
 * (nothing has been asked about this finding yet).
 */

import { context } from './context.js'
import { BdaError } from './types.js'

export type RunState = 'none' | 'investigating' | 'explained' | 'partial' | 'unexplained' | 'done' | 'failed' | 'rejected' | 'stale'

export const TERMINAL_STATES: ReadonlySet<RunState> = new Set<RunState>(['none', 'explained', 'partial', 'unexplained', 'done', 'failed', 'rejected', 'stale'])

export type SubjectWindow = { readonly from: string; readonly through: string } | { readonly relative: string }

/** What a run is about (PLAN-v2 §4 `input.subject`). */
export type Subject = {
  readonly model: string
  readonly metric: string
  readonly window?: SubjectWindow
  readonly baseline?: SubjectWindow | { readonly shift: string }
  readonly segment_key?: string
}

export type Figure = { readonly fig: number; readonly value: number; readonly unit?: string | null }

export type CauseEvidence = {
  readonly ref: number
  readonly kind: 'query' | 'finding' | string
  readonly evidence_id?: string
  readonly sql?: string
  readonly cache_only?: boolean
  readonly finding_key?: string
}

export type Cause = {
  readonly cause_id: string
  readonly rank?: number
  readonly type?: string
  readonly title: string
  readonly mechanism?: string
  readonly dimensions?: readonly string[]
  readonly share_of_change_pct?: number | null
  readonly confidence?: number | null
  readonly evidence?: readonly CauseEvidence[]
  readonly next_checks?: readonly string[]
}

/** The `cause` agent's output (PLAN-v2 §4 `output.schema`), as far as the card reads it. */
export type CauseOutput = {
  readonly verdict?: 'explained' | 'partial' | 'unexplained'
  readonly figures?: readonly Figure[]
  readonly causes?: readonly Cause[]
  readonly narrative?: string
  readonly next_questions?: readonly string[]
  readonly warnings?: readonly string[]
}

export type RunFeedback = {
  readonly mine: { readonly verdict: 'accept' | 'reject' | 'correct'; readonly cause_ids?: readonly string[]; readonly at?: string } | null
  readonly accepted_by_count: number
  readonly rejected_by_count: number
  readonly accepted: boolean
}

/** Studio's `RunView` (cause-studio contract §3), as far as the card reads it. */
export type RunView = {
  readonly run_id: string
  readonly agent?: { readonly id: string; readonly version: number }
  readonly finding_key: string | null
  readonly subject_key: string | null
  readonly match?: 'finding' | 'subject' | null
  readonly window?: { readonly from: string; readonly through: string } | null
  readonly status: string
  readonly state: Exclude<RunState, 'none'>
  readonly terminal: boolean
  readonly verdict?: 'explained' | 'partial' | 'unexplained' | null
  readonly stale?: boolean
  readonly progress?: string | null
  readonly created_at?: string
  readonly finished_at?: string | null
  readonly output?: CauseOutput | null
  readonly warnings?: readonly string[]
  readonly error?: { readonly code: string; readonly message: string } | null
  readonly attached?: boolean
  readonly feedback?: RunFeedback
}

export type AgentRunUpdate = {
  readonly findingKey: string | null
  readonly subjectKey: string | null
  readonly runId: string | null
  readonly state: RunState
  readonly match: 'finding' | 'subject' | null
  readonly asOf: string | null
  readonly run?: RunView
  readonly error?: BdaError
}

/** Everything the frame knows about one finding — what `start` and `get` send. */
export type FindingRef = {
  readonly findingKey: string
  readonly subjectKey?: string
  /** The DE job the finding came from, so Studio can read the row itself. */
  readonly jobId?: string
  readonly subject?: Subject
  /** The row as the app shows it: `current_value` / `baseline_value` decide `stale`. */
  readonly row?: Readonly<Record<string, unknown>>
  readonly panelId?: string
  readonly agentId?: string
  /** The panel's narrowed filters (`{field, op, value}`, ≤ 8), which Studio puts in the run's `context.filters`. */
  readonly filters?: readonly { readonly field: string; readonly op: string; readonly value: unknown }[]
  /**
   * `start` only: the agent's own input, for an agent whose input is not a finding (`ticket_coverage`:
   * a source query and a match rule). Sent verbatim (contract §1.1 form (a)); `findingKey` then only names
   * the card that asked, which replies and pushes carry back. Needs a host that forwards it (ui !47).
   */
  readonly input?: Readonly<Record<string, unknown>>
}

export type Verdict = 'accept' | 'reject' | 'correct'

export type AgentRunRequest =
  | ({ readonly action: 'get' | 'start'; readonly question?: string; readonly rerun?: boolean } & FindingRef)
  | ({ readonly action: 'cancel'; readonly runId: string } & FindingRef)
  | ({ readonly action: 'feedback'; readonly runId: string; readonly verdict: Verdict; readonly causeIds?: readonly string[]; readonly note?: string } & FindingRef)

const HOST_AGENT_RUN = 'studio:sandbox:agent-run'
const HOST_AGENT_RUN_RESULT = 'studio:sandbox:agent-run-result'
const HOST_TIMEOUT_MS = 60_000
let nextRequestId = 0

type HostReply = {
  type?: string
  requestId?: string
  ok?: boolean
  findingKey?: string | null
  subjectKey?: string | null
  runId?: string | null
  state?: RunState
  match?: 'finding' | 'subject' | null
  asOf?: string | null
  run?: RunView
  error?: { code?: string; message?: string; status?: number }
}

function toUpdate(reply: HostReply): AgentRunUpdate {
  const error = reply.ok === true ? undefined : new BdaError(reply.error?.code ?? 'request_failed', reply.error?.message ?? 'The host could not reach the agent.', reply.error?.status ?? 0)
  return {
    findingKey: reply.findingKey ?? null,
    subjectKey: reply.subjectKey ?? null,
    runId: reply.runId ?? reply.run?.run_id ?? null,
    state: reply.state ?? reply.run?.state ?? 'none',
    match: reply.match ?? reply.run?.match ?? null,
    asOf: reply.asOf ?? reply.run?.finished_at ?? null,
    ...(reply.run === undefined ? {} : { run: reply.run }),
    ...(error === undefined ? {} : { error }),
  }
}

/* ------------------------------------------------- pushed updates (framed) */

const listeners = new Set<(update: AgentRunUpdate) => void>()
let listening = false

function onPushed(event: MessageEvent<HostReply>): void {
  const reply = event.data
  if (reply === null || typeof reply !== 'object' || reply.type !== HOST_AGENT_RUN_RESULT) return
  const update = toUpdate(reply)
  for (const listener of listeners) listener(update)
}

/** Every run update the host sends — answers and pushes alike. Returns an unsubscribe. */
export function onAgentRunUpdate(listener: (update: AgentRunUpdate) => void): () => void {
  if (!listening && typeof window !== 'undefined') {
    listening = true
    window.addEventListener('message', onPushed)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && listening) {
      listening = false
      window.removeEventListener('message', onPushed)
    }
  }
}

function wire(request: AgentRunRequest): Record<string, unknown> {
  const { action, findingKey, subjectKey, jobId, subject, row, panelId, agentId } = request
  return {
    action,
    agentId: agentId ?? 'cause',
    findingKey,
    ...(subjectKey === undefined ? {} : { subjectKey }),
    ...(jobId === undefined ? {} : { jobId }),
    ...(subject === undefined ? {} : { subject }),
    ...(row === undefined ? {} : { row }),
    ...(panelId === undefined ? {} : { panelId }),
    ...(request.action === 'start' && request.filters !== undefined && request.filters.length > 0 ? { filters: request.filters.slice(0, 8) } : {}),
    ...(request.action === 'start' && request.input !== undefined ? { input: request.input } : {}),
    ...('question' in request && request.question !== undefined ? { question: request.question } : {}),
    ...('rerun' in request && request.rerun === true ? { rerun: true } : {}),
    ...('runId' in request ? { runId: request.runId } : {}),
    ...('verdict' in request ? { verdict: request.verdict } : {}),
    ...('causeIds' in request && request.causeIds !== undefined ? { causeIds: [...request.causeIds] } : {}),
    ...('note' in request && request.note !== undefined ? { note: request.note } : {}),
  }
}

function viaHost(request: AgentRunRequest): Promise<AgentRunUpdate> {
  const requestId = `r${(nextRequestId += 1)}`
  return new Promise<AgentRunUpdate>((resolve) => {
    const settle = (update: AgentRunUpdate) => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer)
      resolve(update)
    }
    const onMessage = (event: MessageEvent<HostReply>) => {
      const reply = event.data
      if (reply?.type !== HOST_AGENT_RUN_RESULT || reply.requestId !== requestId) return
      settle(toUpdate(reply))
    }
    const timer = window.setTimeout(
      () => settle({ findingKey: request.findingKey, subjectKey: request.subjectKey ?? null, runId: null, state: 'none', match: null, asOf: null, error: new BdaError('host_timeout', 'The host did not answer the agent request.', 0) }),
      HOST_TIMEOUT_MS,
    )
    window.addEventListener('message', onMessage)
    window.parent.postMessage({ type: HOST_AGENT_RUN, requestId, ...wire(request) }, '*')
  })
}

/* ------------------------------------------------ development (no host) */

type ApiRun = RunView & { readonly match?: 'finding' | 'subject' | null }

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

function fromRun(request: FindingRef, run: ApiRun | undefined): AgentRunUpdate {
  if (run === undefined) return { findingKey: request.findingKey, subjectKey: request.subjectKey ?? null, runId: null, state: 'none', match: null, asOf: null }
  return { findingKey: run.finding_key ?? request.findingKey, subjectKey: run.subject_key ?? request.subjectKey ?? null, runId: run.run_id, state: run.state, match: run.match ?? null, asOf: run.finished_at ?? null, run }
}

function liveQuery(row: FindingRef['row']): string {
  const params = new URLSearchParams()
  for (const name of ['current_value', 'baseline_value']) if (typeof row?.[name] === 'number') params.set(name, String(row[name]))
  return params.toString()
}

/** Development only: one request against the API directly. The dev loop re-asks with `get` while a run is live. */
async function direct(request: AgentRunRequest): Promise<AgentRunUpdate> {
  const { apiBase, appId, token } = context()
  const base = `${apiBase}/data-apps/${encodeURIComponent(appId)}/agent-runs`
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  try {
    let response: Response
    switch (request.action) {
      case 'get': {
        const params = new URLSearchParams({ finding_key: request.findingKey, limit: '1' })
        if (request.subjectKey !== undefined) params.set('subject_key', request.subjectKey)
        const live = liveQuery(request.row)
        response = await fetch(`${base}?${params.toString()}${live === '' ? '' : `&${live}`}`, { headers })
        if (!response.ok) throw await toError(response)
        const body = (await response.json()) as { runs?: ApiRun[] }
        return fromRun(request, body.runs?.[0])
      }
      case 'start':
        response = await fetch(base, {
          method: 'POST',
          headers,
          body: JSON.stringify(request.input !== undefined ? {
            agent_id: request.agentId ?? 'cause',
            input: request.input,
            ...(request.question === undefined ? {} : { question: request.question }),
            ...(request.panelId === undefined ? {} : { panel_id: request.panelId }),
            ...(request.rerun === true ? { rerun: true } : {}),
          } : {
            agent_id: request.agentId ?? 'cause',
            finding_key: request.findingKey,
            ...(request.jobId === undefined ? {} : { job_id: request.jobId }),
            ...(request.row === undefined ? {} : { finding: { row: { ...request.row, ...(request.subject === undefined ? {} : { subject: request.subject }) } } }),
            ...(request.question === undefined ? {} : { question: request.question }),
            ...(request.panelId === undefined ? {} : { panel_id: request.panelId }),
            ...(request.filters === undefined || request.filters.length === 0 ? {} : { filters: request.filters.slice(0, 8) }),
            ...(request.rerun === true ? { rerun: true } : {}),
          }),
        })
        break
      case 'cancel':
        response = await fetch(`${base}/${encodeURIComponent(request.runId)}/cancel`, { method: 'POST', headers })
        break
      case 'feedback': {
        response = await fetch(`${base}/${encodeURIComponent(request.runId)}/feedback`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ verdict: request.verdict, ...(request.causeIds === undefined ? {} : { cause_ids: request.causeIds }), ...(request.note === undefined ? {} : { note: request.note }) }),
        })
        if (!response.ok) throw await toError(response)
        return fromRun(request, ((await response.json()) as { run?: ApiRun }).run)
      }
    }
    if (!response.ok) throw await toError(response)
    return fromRun(request, (await response.json()) as ApiRun)
  } catch (error) {
    return { findingKey: request.findingKey, subjectKey: request.subjectKey ?? null, runId: null, state: 'none', match: null, asOf: null, error: error instanceof BdaError ? error : new BdaError('network_error', (error as Error)?.message ?? 'The agent request failed.', 0) }
  }
}

/** Whether a host is brokering: framed, the host polls and pushes; in dev the caller polls with `get`. */
export function hostPolls(): boolean {
  return typeof window !== 'undefined' && window.parent !== window
}

/** One request. Never rejects: a failure is an update with `error` set, so a card always has something to draw. */
export function requestAgentRun(request: AgentRunRequest): Promise<AgentRunUpdate> {
  return hostPolls() ? viaHost(request) : direct(request)
}

/* ------------------------------------------------------------- keys */

/**
 * `subject_key` (cause-studio contract §5): `sha256(model, metric,
 * segment_key, window_spec)[:20]`, joined by newlines. `window_spec` is a
 * relative window's name or the window's length (`P7D`) — not its dates —
 * plus `|<shift>` for a shifted baseline, so a weekly panel that rolls over
 * still finds last week's explanation. Studio computes the same key and its
 * value is the one indexed; the frame's copy is only used to look it up.
 */
export function subjectKey(subject: Subject): string | undefined {
  if (subject.model === '' || subject.metric === '') return undefined
  return sha256Hex([subject.model, subject.metric, subject.segment_key ?? '', windowSpec(subject.window, subject.baseline)].join('\n')).slice(0, 20)
}

export function windowSpec(window: SubjectWindow | undefined, baseline?: Subject['baseline']): string {
  let spec = ''
  if (window !== undefined && 'relative' in window) spec = window.relative
  else if (window !== undefined) {
    const from = Date.parse(`${window.from.slice(0, 10)}T00:00:00Z`)
    const through = Date.parse(`${window.through.slice(0, 10)}T00:00:00Z`)
    if (!Number.isNaN(from) && !Number.isNaN(through) && through >= from) spec = `P${Math.round((through - from) / 86_400_000) + 1}D`
  }
  const shift = baseline !== undefined && 'shift' in baseline ? baseline.shift : undefined
  return shift === undefined ? spec : `${spec}|${shift}`
}

/** A half-open `…T00:00:00Z` end as the inclusive last day; a bare date as itself. */
function through(end: string | null | undefined): string | undefined {
  if (typeof end !== 'string' || end.length < 10) return undefined
  const day = end.slice(0, 10)
  if (end.length > 10 && /T00:00:00(\.0+)?(Z|[+-]00:00)?$/.test(end)) return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  return day
}

function span(start: string | null | undefined, end: string | null | undefined): { from: string; through: string } | undefined {
  const last = through(end)
  return typeof start === 'string' && start.length >= 10 && last !== undefined ? { from: start.slice(0, 10), through: last } : undefined
}

/** The subject a `bicycle.findings/v1` row is about — Studio's `subject_of_row`, restated. */
export function subjectOfRow(row: { readonly kpi_name?: string | null; readonly segment_key?: string | null; readonly window_start?: string | null; readonly window_end?: string | null; readonly baseline_start?: string | null; readonly baseline_end?: string | null }, model: string): Subject {
  const window = span(row.window_start, row.window_end)
  const baseline = span(row.baseline_start, row.baseline_end)
  return { model, metric: row.kpi_name ?? '', segment_key: row.segment_key ?? '', ...(window === undefined ? {} : { window }), ...(baseline === undefined ? {} : { baseline }) }
}

/* ------------------------------------------------------------- sha256 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/**
 * SHA-256 of a string's UTF-8 bytes, as hex. Synchronous on purpose — a key
 * is needed while rendering — and small enough to carry: `crypto.subtle` is
 * async and not promised inside an opaque-origin frame.
 */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const length = bytes.length
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6)
  padded.set(bytes)
  padded[length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor((length * 8) / 2 ** 32))
  view.setUint32(padded.length - 4, (length * 8) >>> 0)
  const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15] as number
      const b = w[i - 2] as number
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = hash as unknown as [number, number, number, number, number, number, number, number]
    for (let i = 0; i < 64; i += 1) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + (K[i] as number) + (w[i] as number)) >>> 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      h = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    hash[0] = ((hash[0] as number) + a) >>> 0
    hash[1] = ((hash[1] as number) + b) >>> 0
    hash[2] = ((hash[2] as number) + c) >>> 0
    hash[3] = ((hash[3] as number) + d) >>> 0
    hash[4] = ((hash[4] as number) + e) >>> 0
    hash[5] = ((hash[5] as number) + f) >>> 0
    hash[6] = ((hash[6] as number) + g) >>> 0
    hash[7] = ((hash[7] as number) + h) >>> 0
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, '0')).join('')
}
