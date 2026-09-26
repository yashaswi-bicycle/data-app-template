/**
 * `bda.fn`: an app's published functions and workflows, run through the Studio host (ui-bicycle-studio
 * `sandbox/fnBridge.ts`, INVOCATIONS.md "v1.2 apps"). Served by Studio (`GET /api/data-apps/sdk`, MCP `dataapp_sdk`)
 * for a template-built app's `src/studio/`; it needs the template's `src/studio/types.ts` (BdaError) and nothing else.
 *
 *   -> { type: 'studio:sandbox:fn-call', requestId, name, input, mode: 'submit' | 'invoke', reuse?, refresh? }
 *   <- { type: 'studio:sandbox:fn-result', requestId, ok, invocation?, error? }
 *   -> { type: 'studio:sandbox:fn-watch', requestId, invocationId, after }
 *   <- { type: 'studio:sandbox:fn-events', requestId, invocationId, ok, events, agentEvents, items, nextAfter,
 *        invocation?, error?, final }   (repeated until final)
 *   -> { type: 'studio:sandbox:fn-cancel', requestId, invocationId }  <- fn-result
 *
 * What an app may call is declared in `bda.manifest.json` `functions: {<local>: {ref}}`, pinned: a function
 * (`fn:{tenant}/{name}@{n}`) or a published workflow (`wf:{tenant}/{slug}@{n}`). App code names the LOCAL name
 * only - the host refuses a ref or an undeclared name - and Studio runs the ref as the viewer. Output is data:
 * render it as text, never as HTML.
 */

import { BdaError } from './types.js'

export type InvocationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** Studio's Invocation record (the fields an app reads). */
export type Invocation = {
  readonly invocation_id: string
  readonly kind?: string
  readonly status: InvocationStatus
  readonly created_at?: string
  readonly started_at?: string
  readonly finished_at?: string
  readonly output?: unknown
  readonly error?: { readonly code?: string; readonly message?: string } | null
  readonly usage?: { readonly llm_usd?: number; readonly wall_ms?: number; readonly steps?: number; readonly tool_calls?: number }
  /** true: Studio answered an earlier run of the same call (yours, within `reuse`); `created_at` says when it ran. */
  readonly reused?: boolean
  /** true: the same call was already running; this is that run. */
  readonly attached?: boolean
  /** While `queued` for a free agent slot: how many runs are ahead (0 = next). */
  readonly queue_position?: number
}

/** One progress line in words, as the host read an event ("Step 3", "Atlassian · search jira issues"). */
export type ProgressItem = {
  readonly key: string
  readonly at?: string
  readonly kind: string
  readonly title: string
  readonly detail?: string
  readonly meta?: string
  readonly bad?: boolean
}

export type FnEvents = {
  readonly invocationId: string
  readonly events: readonly Record<string, unknown>[]
  readonly agentEvents: readonly Record<string, unknown>[]
  readonly items: readonly ProgressItem[]
  readonly nextAfter: number
}

export type Watch = {
  /** The final invocation (terminal), or rejects with a BdaError when watching failed. */
  readonly done: Promise<Invocation>
  /** Stop listening (the run carries on). */
  readonly stop: () => void
}

const CALL = 'studio:sandbox:fn-call'

export type CallOptions = {
  /** true (default): resolve with the output once the run ends. false: resolve with the queued invocation. */
  readonly wait?: boolean
  /** Progress while waiting. */
  readonly onEvent?: (events: FnEvents) => void
  /** Told the invocation id as soon as it exists (for a Cancel button, or a link to its trace). */
  readonly onStart?: (invocation: Invocation) => void
  /**
   * Answer from your own earlier run of the same call if it succeeded within this window ("6h"; at most "24h").
   * ALWAYS pass it for a call made on page load, and show "as of <created_at>" with a Refresh.
   */
  readonly reuse?: string
  /** true: always a new run (the Refresh button). */
  readonly refresh?: boolean
}

const callMessage = (name: string, input: Record<string, unknown>, options: CallOptions) => ({
  type: CALL,
  name,
  input,
  mode: 'submit',
  ...(options.reuse !== undefined ? { reuse: options.reuse } : {}),
  ...(options.refresh === true ? { refresh: true } : {}),
})

const RESULT = 'studio:sandbox:fn-result'
const WATCH = 'studio:sandbox:fn-watch'
const EVENTS = 'studio:sandbox:fn-events'
const CANCEL = 'studio:sandbox:fn-cancel'
const HOST_TIMEOUT_MS = 60_000
const TERMINAL = new Set<string>(['succeeded', 'failed', 'cancelled'])
let nextRequestId = 0

type Reply = {
  type?: string
  requestId?: string
  ok?: boolean
  invocation?: Invocation
  error?: { code?: string; message?: string; status?: number }
  final?: boolean
} & Partial<FnEvents>

const framed = () => typeof window !== 'undefined' && window.parent !== window

const toError = (error: Reply['error'] | undefined, fallback: string) =>
  new BdaError(error?.code ?? 'request_failed', error?.message ?? fallback, error?.status ?? 0)

/** One request, one fn-result reply. */
const ask = (message: Record<string, unknown>): Promise<Invocation> => {
  if (!framed()) return Promise.reject(new BdaError('fn_unavailable', 'Functions need the Studio host.', 0))
  const requestId = `f${(nextRequestId += 1)}`
  return new Promise<Invocation>((resolve, reject) => {
    const settle = (run: () => void) => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer)
      run()
    }
    const onMessage = (event: MessageEvent<Reply>) => {
      const reply = event.data
      if (reply?.type !== RESULT || reply.requestId !== requestId) return
      const invocation = reply.invocation
      if (reply.ok === true && invocation !== undefined) settle(() => resolve(invocation))
      else settle(() => reject(toError(reply.error, 'The call failed.')))
    }
    const timer = window.setTimeout(() => settle(() => reject(new BdaError('host_timeout', 'The host did not answer.', 0))), HOST_TIMEOUT_MS)
    window.addEventListener('message', onMessage)
    window.parent.postMessage({ ...message, requestId }, '*')
  })
}

/** Follow a run this app started, event by event, until it ends. */
export const watch = (invocationId: string, onEvent?: (events: FnEvents) => void, after = 0): Watch => {
  if (!framed()) {
    return { done: Promise.reject(new BdaError('fn_unavailable', 'Functions need the Studio host.', 0)), stop: () => undefined }
  }
  const requestId = `w${(nextRequestId += 1)}`
  let stop = () => undefined as void
  const done = new Promise<Invocation>((resolve, reject) => {
    const onMessage = (event: MessageEvent<Reply>) => {
      const reply = event.data
      if (reply?.type !== EVENTS || reply.requestId !== requestId) return
      if (reply.ok === false) {
        stop()
        reject(toError(reply.error, 'Following the run failed.'))
        return
      }
      if ((reply.events?.length ?? 0) + (reply.agentEvents?.length ?? 0) > 0) {
        onEvent?.({
          invocationId,
          events: reply.events ?? [],
          agentEvents: reply.agentEvents ?? [],
          items: reply.items ?? [],
          nextAfter: reply.nextAfter ?? 0,
        })
      }
      if (reply.final === true) {
        stop()
        if (reply.invocation) resolve(reply.invocation)
        else reject(new BdaError('invocation_unreadable', 'The run ended but its result could not be read.', 0))
      }
    }
    stop = () => window.removeEventListener('message', onMessage)
    window.addEventListener('message', onMessage)
    window.parent.postMessage({ type: WATCH, requestId, invocationId, after }, '*')
  })
  return { done, stop: () => stop() }
}

/** The final invocation's output, or a readable BdaError for a failed or cancelled run. */
export const outputOf = (invocation: Invocation): unknown => {
  if (invocation.status === 'succeeded') return invocation.output
  if (invocation.status === 'cancelled') throw new BdaError('cancelled', 'The run was cancelled.', 0)
  throw new BdaError(invocation.error?.code ?? 'function_failed', invocation.error?.message ?? 'The run failed.', 0)
}

/** Start a run and wait for its final invocation (output, usage, timings), with progress on the way. */
export const run = async (name: string, input: Record<string, unknown>, options: Omit<CallOptions, 'wait'> = {}): Promise<Invocation> => {
  const started = await ask(callMessage(name, input, options))
  options.onStart?.(started)
  if (TERMINAL.has(started.status)) return started
  return watch(started.invocation_id, options.onEvent).done
}

/**
 * `bda.fn.call(name, input)`: the output once the run ends (throws a BdaError in words when it failed).
 * `{wait: false}`: the queued invocation at once; follow it with `bda.fn.watch`.
 */
export function call(name: string, input: Record<string, unknown>, options: CallOptions & { wait: false }): Promise<Invocation>
export function call<T = unknown>(name: string, input: Record<string, unknown>, options?: CallOptions): Promise<T>
export async function call(name: string, input: Record<string, unknown>, options: CallOptions = {}): Promise<unknown> {
  if (options.wait === false) {
    const started = await ask(callMessage(name, input, options))
    options.onStart?.(started)
    return started
  }
  return outputOf(await run(name, input, options))
}

/** Cancel a run this app started. */
export const cancel = (invocationId: string): Promise<Invocation> => ask({ type: CANCEL, invocationId })

export const fn = { call, run, watch, cancel, outputOf } as const
