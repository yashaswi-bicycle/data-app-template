/**
 * The answer to "why did this change?" for one finding, as an agent run
 * (`cause`) found it — rendered in the frame, fed by `useAgentRun`.
 *
 * Everything the agent wrote is untrusted text. It is rendered as text nodes
 * only: no markdown, no HTML, no links. The two pieces of structure it may
 * carry are resolved here against the run's own output, never against the
 * text: `[fig:n]` becomes a chip showing figure n's checked value (a figure
 * the runner recomputed from saved evidence), and `[n]` becomes a button that
 * opens that cause's n-th evidence entry — the query it ran, or the finding
 * it started from.
 *
 * The viewer can say ✓ (this is right), ✗ (this is wrong — the card then
 * reads `rejected` for them) or correct it with a note. Feedback goes to the
 * service and is never read back into an agent prompt by the app.
 */

import { type ReactNode, useState } from 'react'
import { fmtCompact } from '../format.js'
import type { Cause, CauseEvidence, CauseOutput, Figure, FindingRef, RunState } from '../studio/agentRun.js'
import { useAgentRun } from '../studio/agentRunHooks.js'
import { SkeletonText } from '../components/Skeleton.js'

function fmtFigure(figure: Figure | undefined): string {
  if (figure === undefined || typeof figure.value !== 'number' || !Number.isFinite(figure.value)) return '?'
  const { value, unit } = figure
  if (unit === 'pct' || unit === 'percent') return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}%`
  if (unit === 'pp') return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)} pts`
  return fmtCompact(value)
}

/** `[fig:n]` -> a chip, `[n]` -> an evidence button, everything else -> plain text nodes. */
export function renderAgentText(text: string, figures: readonly Figure[], onRef?: (n: number) => void): ReactNode[] {
  const nodes: ReactNode[] = []
  const byFig = new Map(figures.map((figure) => [figure.fig, figure] as const))
  const pattern = /\[fig:(\d+)\]|\[(\d+)\]/g
  let last = 0
  let key = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) nodes.push(text.slice(last, index))
    if (match[1] !== undefined) {
      const figure = byFig.get(Number(match[1]))
      nodes.push(
        <span key={key++} className="kit-cause__fig" title={figure === undefined ? 'This figure is not in the run’s checked figures.' : `Figure ${figure.fig}, recomputed from the run’s evidence`}>
          {fmtFigure(figure)}
        </span>,
      )
    } else {
      const n = Number(match[2])
      nodes.push(
        onRef === undefined ? (
          `[${n}]`
        ) : (
          <button key={key++} type="button" className="kit-summary__ref" onClick={() => onRef(n)}>
            {`[${n}]`}
          </button>
        ),
      )
    }
    last = index + match[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

const VERDICT_WORDS: Record<string, string> = {
  explained: 'Explained',
  partial: 'Partly explained',
  unexplained: 'Not explained',
  done: 'Done',
  stale: 'Out of date',
  rejected: 'Marked wrong',
  investigating: 'Investigating…',
  failed: 'Could not explain',
}

const WARNING_WORDS: Record<string, string> = {
  ungrounded_literal: 'Some numbers in the text were not checked against the data.',
  unknown_dimension: 'A cause named a field the app does not use.',
}

function EvidenceNote({ evidence, onClose }: { evidence: CauseEvidence | undefined; onClose: () => void }) {
  return (
    <div className="kit-cause__evidence" role="note">
      {evidence === undefined ? (
        <span className="bda-subtle">This reference is not in the run’s evidence.</span>
      ) : evidence.kind === 'query' ? (
        <>
          <div className="bda-subtle">{`[${evidence.ref}] ${evidence.cache_only === true ? 'Cached query' : 'Query'} the agent ran as you`}</div>
          <code className="kit-cause__sql">{evidence.sql ?? ''}</code>
        </>
      ) : evidence.kind === 'finding' ? (
        <div className="bda-subtle">{`[${evidence.ref}] The finding this run started from`}</div>
      ) : (
        <div className="bda-subtle">{`[${evidence.ref}] ${evidence.kind}`}</div>
      )}
      <button type="button" className="kit-cause__link" onClick={onClose}>
        Close
      </button>
    </div>
  )
}

function CauseItem({ cause, figures }: { cause: Cause; figures: readonly Figure[] }) {
  const [open, setOpen] = useState<number | undefined>(undefined)
  const evidence = cause.evidence ?? []
  const toggle = (n: number) => setOpen((current) => (current === n ? undefined : n))
  return (
    <li className="kit-cause__item">
      <div className="kit-cause__title">{renderAgentText(cause.title, figures, toggle)}</div>
      <div className="kit-cause__meta bda-subtle">
        {typeof cause.share_of_change_pct === 'number' ? <span>{`${Math.round(cause.share_of_change_pct)}% of the change`}</span> : null}
        {typeof cause.confidence === 'number' ? <span>{`confidence ${Math.round(cause.confidence * 100)}%`}</span> : null}
        {evidence.map((entry) => (
          <button key={entry.ref} type="button" className="kit-summary__ref" aria-pressed={open === entry.ref} onClick={() => toggle(entry.ref)}>
            {`[${entry.ref}]`}
          </button>
        ))}
      </div>
      {cause.mechanism !== undefined && cause.mechanism !== '' ? <p className="kit-cause__mechanism">{renderAgentText(cause.mechanism, figures, toggle)}</p> : null}
      {open !== undefined ? <EvidenceNote evidence={evidence.find((entry) => entry.ref === open)} onClose={() => setOpen(undefined)} /> : null}
      {(cause.next_checks ?? []).length > 0 ? (
        <ul className="kit-cause__checks bda-subtle">
          {(cause.next_checks ?? []).map((check, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list from one output — nothing reorders it
            <li key={index}>{check}</li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function Feedback({ state, mine, acceptedBy, busy, onFeedback }: { state: RunState; mine: string | undefined; acceptedBy: number; busy: boolean; onFeedback: (verdict: 'accept' | 'reject' | 'correct', note?: string) => void }) {
  const [correcting, setCorrecting] = useState(false)
  const [note, setNote] = useState('')
  if (state === 'investigating' || state === 'failed' || state === 'none') return null
  return (
    <div className="kit-cause__feedback">
      <button type="button" className="bda-pill" aria-pressed={mine === 'accept'} disabled={busy} onClick={() => onFeedback('accept')} title="This explanation is right">
        ✓ Right
      </button>
      <button type="button" className="bda-pill" aria-pressed={mine === 'reject'} disabled={busy} onClick={() => onFeedback('reject')} title="This explanation is wrong">
        ✗ Wrong
      </button>
      <button type="button" className="bda-pill" aria-pressed={mine === 'correct' || correcting} disabled={busy} onClick={() => setCorrecting((value) => !value)}>
        Correct…
      </button>
      {acceptedBy > 0 ? <span className="bda-subtle">{`confirmed by ${acceptedBy}`}</span> : null}
      {correcting ? (
        <form
          className="kit-cause__correct"
          onSubmit={(event) => {
            event.preventDefault()
            if (note.trim() === '') return
            onFeedback('correct', note.trim().slice(0, 2000))
            setCorrecting(false)
            setNote('')
          }}
        >
          <textarea aria-label="What is the real reason?" maxLength={2000} placeholder="What is the real reason?" value={note} onChange={(event) => setNote(event.target.value)} />
          <button type="submit" className="bda-pill" disabled={busy || note.trim() === ''}>
            Send
          </button>
        </form>
      ) : null}
    </div>
  )
}

function fmtDay(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length < 10) return ''
  return new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** One finding's "why", from nothing asked yet to a checked answer the viewer can grade. */
export function CauseCard({ finding, label }: { finding: FindingRef; label?: string }) {
  const run = useAgentRun(finding)
  const update = run.update
  const state: RunState = update?.state ?? 'none'
  const view = update?.run
  const output: CauseOutput = view?.output ?? {}
  const figures = output.figures ?? []
  const causes = [...(output.causes ?? [])].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
  const warnings = [...new Set([...(view?.warnings ?? []), ...(output.warnings ?? [])])].filter((code) => WARNING_WORDS[code] !== undefined)
  const answered = state === 'explained' || state === 'partial' || state === 'unexplained' || state === 'done' || state === 'stale' || state === 'rejected'
  const subjectMatch = update?.match === 'subject' && view?.window
  return (
    <div className="kit-cause" aria-busy={state === 'investigating' || (update === undefined && run.error === undefined)} data-state={state}>
      <div className="kit-cause__head">
        <span className="kit-sh">{label ?? 'Why?'}</span>
        {update !== undefined && state !== 'none' ? <span className={`kit-cause__badge kit-cause__badge--${state}`}>{VERDICT_WORDS[state] ?? state}</span> : null}
        {subjectMatch ? <span className="bda-subtle">{`explained for ${fmtDay(view.window?.from)} – ${fmtDay(view.window?.through)}${update.asOf ? ` (as of ${fmtDay(update.asOf)})` : ''}`}</span> : null}
      </div>
      {run.error !== undefined ? (
        <div className="bda-subtle kit-cause__note">{run.error.code === 'agent_runs_unavailable' ? 'Explanations are not available here.' : `${run.error.message} (${run.error.code})`}</div>
      ) : null}
      {update === undefined && run.error === undefined ? <SkeletonText lines={2} /> : null}
      {update !== undefined && state === 'none' ? (
        <div className="kit-cause__start">
          <button type="button" className="bda-pill" disabled={run.busy} onClick={() => run.start()}>
            Why did this change?
          </button>
          <span className="bda-subtle">An agent reads the data as you and says what drove it, with every number checked.</span>
        </div>
      ) : null}
      {state === 'investigating' ? (
        <div className="kit-cause__live">
          <span className="bda-subtle">{view?.progress ?? 'Looking through the data…'}</span>
          <button type="button" className="kit-cause__link" disabled={run.busy} onClick={() => run.cancel()}>
            Cancel
          </button>
        </div>
      ) : null}
      {state === 'failed' ? (
        <div className="kit-cause__live">
          <span className="bda-subtle">{view?.error?.message ?? 'The agent could not finish.'}</span>
          <button type="button" className="bda-pill" disabled={run.busy} onClick={() => run.start({ rerun: true })}>
            Try again
          </button>
        </div>
      ) : null}
      {state === 'stale' || state === 'rejected' ? (
        <div className="kit-cause__live">
          <span className="bda-subtle">{state === 'stale' ? 'The numbers have moved since this was explained.' : 'You marked this explanation wrong.'}</span>
          <button type="button" className="bda-pill" disabled={run.busy} onClick={() => run.start({ rerun: true })}>
            Re-run
          </button>
        </div>
      ) : null}
      {answered ? (
        <>
          {output.narrative !== undefined && output.narrative !== '' ? <p className="kit-cause__narrative">{renderAgentText(output.narrative, figures)}</p> : null}
          {causes.length > 0 ? (
            <ol className="kit-cause__list">
              {causes.map((cause) => (
                <CauseItem key={cause.cause_id} cause={cause} figures={figures} />
              ))}
            </ol>
          ) : state === 'unexplained' ? (
            <div className="bda-subtle">No cause in the data accounts for this change.</div>
          ) : null}
          {warnings.map((code) => (
            <div key={code} className="bda-subtle kit-cause__warning">
              {WARNING_WORDS[code]}
            </div>
          ))}
          <Feedback
            state={state}
            mine={view?.feedback?.mine?.verdict}
            acceptedBy={view?.feedback?.accepted_by_count ?? 0}
            busy={run.busy}
            onFeedback={(verdict, note) => run.feedback(verdict, { causeIds: causes.map((cause) => cause.cause_id), ...(note === undefined ? {} : { note }) })}
          />
        </>
      ) : null}
    </div>
  )
}
