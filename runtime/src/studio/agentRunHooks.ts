/**
 * `useAgentRun(finding)`: the state of the agent run about one finding, and
 * the three things a viewer can do about it (start / re-run, cancel, give
 * feedback). See `agentRun.ts` for the wire.
 *
 * On mount (and whenever the finding changes) it asks the host once with
 * `get`, which finds the newest run for this finding — or, failing that, for
 * the same subject (`match: 'subject'`, labelled with its own window) — so a
 * reload lands on the same card. After that it only listens: the host pushes
 * every move of a live run, whoever started it.
 *
 * In development (no host) nothing pushes, so the hook re-asks with `get`
 * itself while the run is live, on the host's own cadence (1.5 s easing out
 * to 4 s, 10 minutes at most).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { type AgentRunUpdate, type FindingRef, hostPolls, onAgentRunUpdate, requestAgentRun, TERMINAL_STATES, type Verdict } from './agentRun.js'
import type { BdaError } from './types.js'

export type AgentRunState = {
  /** `undefined` until the first answer. */
  readonly update: AgentRunUpdate | undefined
  /** A request of this card's is in flight (not the run itself — see `update.state`). */
  readonly busy: boolean
  readonly error: BdaError | undefined
  start(options?: { readonly rerun?: boolean; readonly question?: string }): void
  cancel(): void
  feedback(verdict: Verdict, options?: { readonly causeIds?: readonly string[]; readonly note?: string }): void
}

const DEV_POLL_START_MS = 1500
const DEV_POLL_MAX_MS = 4000
const DEV_POLL_CAP_MS = 600_000

export function useAgentRun(finding: FindingRef | undefined): AgentRunState {
  const [update, setUpdate] = useState<AgentRunUpdate | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<BdaError | undefined>(undefined)
  const findingRef = useRef(finding)
  findingRef.current = finding
  const key = finding?.findingKey
  const runIdRef = useRef<string | null>(null)
  const pollRef = useRef<{ timer?: ReturnType<typeof setTimeout>; started: number } | undefined>(undefined)

  const apply = useCallback((next: AgentRunUpdate) => {
    const current = findingRef.current
    if (current === undefined) return
    const mine = next.findingKey === current.findingKey || (next.runId !== null && next.runId === runIdRef.current)
    if (!mine) return
    if (next.error !== undefined) {
      setError(next.error)
      return
    }
    setError(undefined)
    if (next.runId !== null) runIdRef.current = next.runId
    setUpdate(next)
  }, [])

  const stopDevPoll = useCallback(() => {
    if (pollRef.current?.timer !== undefined) clearTimeout(pollRef.current.timer)
    pollRef.current = undefined
  }, [])

  // Development only: re-ask while live. Framed, the host pushes instead.
  const devPoll = useCallback(
    (delay: number) => {
      if (hostPolls()) return
      const started = pollRef.current?.started ?? Date.now()
      stopDevPoll()
      if (Date.now() - started > DEV_POLL_CAP_MS) return
      pollRef.current = {
        started,
        timer: setTimeout(() => {
          const current = findingRef.current
          if (current === undefined) return
          void requestAgentRun({ action: 'get', ...current }).then((next) => {
            apply(next)
            if (!TERMINAL_STATES.has(next.state) && next.error === undefined) devPoll(Math.min(delay * 2, DEV_POLL_MAX_MS))
          })
        }, delay),
      }
    },
    [apply, stopDevPoll],
  )

  useEffect(() => onAgentRunUpdate(apply), [apply])

  useEffect(() => {
    setUpdate(undefined)
    setError(undefined)
    runIdRef.current = null
    stopDevPoll()
    const current = findingRef.current
    if (current === undefined) return
    let cancelled = false
    void requestAgentRun({ action: 'get', ...current }).then((next) => {
      if (cancelled) return
      apply(next)
      if (!TERMINAL_STATES.has(next.state) && next.error === undefined) devPoll(DEV_POLL_START_MS)
    })
    return () => {
      cancelled = true
      stopDevPoll()
    }
  }, [key, apply, devPoll, stopDevPoll])

  const send = useCallback(
    (request: Parameters<typeof requestAgentRun>[0], thenPoll: boolean) => {
      setBusy(true)
      void requestAgentRun(request).then((next) => {
        setBusy(false)
        apply(next)
        if (thenPoll && !TERMINAL_STATES.has(next.state) && next.error === undefined) devPoll(DEV_POLL_START_MS)
      })
    },
    [apply, devPoll],
  )

  const start = useCallback(
    (options?: { readonly rerun?: boolean; readonly question?: string }) => {
      const current = findingRef.current
      if (current === undefined) return
      send({ action: 'start', ...current, ...(options?.rerun === true ? { rerun: true } : {}), ...(options?.question === undefined ? {} : { question: options.question }) }, true)
    },
    [send],
  )

  const cancel = useCallback(() => {
    const current = findingRef.current
    const runId = runIdRef.current
    if (current === undefined || runId === null) return
    send({ action: 'cancel', ...current, runId }, false)
  }, [send])

  const feedback = useCallback(
    (verdict: Verdict, options?: { readonly causeIds?: readonly string[]; readonly note?: string }) => {
      const current = findingRef.current
      const runId = runIdRef.current
      if (current === undefined || runId === null) return
      send({ action: 'feedback', ...current, runId, verdict, ...(options?.causeIds === undefined ? {} : { causeIds: options.causeIds }), ...(options?.note === undefined ? {} : { note: options.note }) }, false)
    },
    [send],
  )

  return { update, busy, error, start, cancel, feedback }
}
