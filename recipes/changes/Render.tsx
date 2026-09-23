import { type MouseEvent, useEffect, useMemo, useState } from 'react'
import { CauseCard } from '../../runtime/src/chrome/CauseCard.js'
import { initialTime, seedOf, useControlsIfAny } from '../../runtime/src/controls.js'
import { fmtCompact } from '../../runtime/src/format.js'
import { type CoreProps, SectionHead, Widget } from '../../runtime/src/parts.js'
import { analysisById, dimensionLabel, filterControls, type Spec } from '../../runtime/src/spec.js'
import { type FindingRef, subjectKey, subjectOfRow } from '../../runtime/src/studio/agentRun.js'
import { type AnalysisJob, type AnalysisResult, type AnalysisWindow, cancelAnalysis, type Driver, type Finding, filtersOf, phaseOf, type RunBody, watchAnalysis, windowOf } from '../../runtime/src/studio/analysis.js'
import { type FindingReport, MAX_REPORTED_FINDINGS, usePanelId, useSelection } from '../../runtime/src/studio/contextRegistry.js'
import { BdaError } from '../../runtime/src/studio/types.js'

/** What the frame reports as this panel's selection: the finding, and where its row sits in the card (for the host's "Why?" pill). */
export type FindingSelection = { readonly findingKey: string; readonly row?: { readonly top: number; readonly height: number } }

type Run = {
  readonly job?: AnalysisJob
  /** The latest result — kept on screen while a re-run (new window or filters) is in flight. */
  readonly result?: AnalysisResult
  readonly error?: BdaError
  readonly final: boolean
}

/** The fields a run snapshots and the service's stale check reads — what travels with a reported finding. */
const ROW_FIELDS = ['finding_key', 'question_key', 'kpi_name', 'segment_key', 'dimensions', 'current_value', 'baseline_value', 'delta', 'pct_change', 'severity', 'window_start', 'window_end', 'baseline_start', 'baseline_end'] as const

export function trimmedRow(finding: Finding): Record<string, unknown> {
  const record = finding as unknown as Record<string, unknown>
  return Object.fromEntries(ROW_FIELDS.filter((field) => record[field] !== undefined).map((field) => [field, record[field]]))
}

/** One finding, as everything downstream (the host's pill, `CauseCard`, the agent) needs it. */
export function findingRef(spec: Spec, finding: Finding, jobId: string | undefined, panelId: string | undefined): FindingRef {
  const subject = subjectOfRow(finding, spec.model)
  const key = subjectKey(subject)
  return {
    findingKey: finding.finding_key,
    ...(key === undefined ? {} : { subjectKey: key }),
    ...(jobId === undefined ? {} : { jobId }),
    subject,
    row: trimmedRow(finding),
    ...(panelId === undefined ? {} : { panelId }),
  }
}

function segmentLabel(spec: Spec, dimensions: Readonly<Record<string, unknown>>): string {
  const parts = Object.entries(dimensions).map(([field, value]) => `${dimensionLabel(spec, field)}: ${String(value)}`)
  return parts.length === 0 ? 'Overall' : parts.join(' · ')
}

const num = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? fmtCompact(value) : '—')
const pct = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}%` : '—')

function ordinal(n: number): string {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${tail}`
}

function fmtDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function windowLabel(window: AnalysisWindow | undefined): string {
  if (window === undefined) return ''
  if ('relative' in window) return window.relative.replace(/_/g, ' ')
  return window.from === window.through ? fmtDay(window.from) : `${fmtDay(window.from)} – ${fmtDay(window.through)}`
}

/**
 * "What changed and why": a declared analysis (`spec.analyses`, bound by id)
 * run as the viewer over the panel's window and filters, through the host
 * (`studio/analysis.ts`). The job's state is always on screen — queued (and
 * where in line), running, done, failed, abandoned — and when it lands, its
 * findings are a table keyed by `finding_key`; picking one shows its drivers
 * and the agent's explanation (`CauseCard`), and reports the pick to the host
 * so its own "Why?" pill can sit on that row.
 *
 * Nothing here decides what is anomalous: that is the engine's answer, shown
 * as it came back.
 */
export function Render({ spec, bind }: CoreProps) {
  const analysis = analysisById(spec, bind.analysis === 'first' ? undefined : bind.analysis)
  const limit = typeof bind.limit === 'number' ? bind.limit : 20
  const manual = bind.run === 'manual'
  const controls = useControlsIfAny()
  const panelId = usePanelId()
  const [selected, setSelected] = useSelection<FindingSelection>(panelId)
  const [run, setRun] = useState<Run>({ final: false })
  const [attempt, setAttempt] = useState(manual ? 0 : 1)

  // What the run is asked about: the panel's own window and narrowed filters, when the analysis binds them.
  const time = controls?.time ?? initialTime(spec)
  const window = analysis?.bind?.window === false ? undefined : windowOf(time)
  const filters = useMemo(() => {
    if (analysis?.bind?.filters === false || controls === undefined) return []
    const options = new Map(filterControls(spec).map((control) => [control.dim, (control.options ?? seedOf(control)).map(String)]))
    return filtersOf(controls.filters, (dim) => options.get(dim) ?? [])
  }, [analysis, controls, spec])
  const bodyKey = JSON.stringify({ window, filters })

  useEffect(() => {
    if (analysis === undefined || attempt === 0) return
    const body: RunBody = JSON.parse(bodyKey) as RunBody
    setRun((previous) => ({ final: false, ...(previous.result === undefined ? {} : { result: previous.result }) }))
    return watchAnalysis(analysis.id, body, (update) =>
      setRun((previous) => {
        const job = update.job ?? previous.job
        const result = update.result ?? previous.result
        return { ...(job === undefined ? {} : { job }), ...(result === undefined ? {} : { result }), ...(update.error === undefined ? {} : { error: update.error }), final: update.final }
      }),
    )
  }, [analysis, bodyKey, attempt])

  const phase = attempt === 0 ? undefined : phaseOf(run.job, run.error)
  const result = run.result
  const findings = useMemo(() => (result?.findings ?? []).slice(0, limit), [result, limit])
  const jobId = result?.job_id ?? run.job?.job_id
  const reports = useMemo<FindingReport[]>(
    () =>
      findings.slice(0, MAX_REPORTED_FINDINGS).map((finding) => {
        const ref = findingRef(spec, finding, jobId, panelId)
        return { findingKey: ref.findingKey, ...(ref.subjectKey === undefined ? {} : { subjectKey: ref.subjectKey }), ...(jobId === undefined ? {} : { jobId }), ...(ref.subject === undefined ? {} : { subject: ref.subject }), row: ref.row ?? {} }
      }),
    [findings, jobId, panelId, spec],
  )
  const selectedFinding = findings.find((finding) => finding.finding_key === selected?.findingKey)
  const drivers = useMemo<Driver[]>(
    () =>
      selectedFinding === undefined
        ? []
        : (result?.drivers ?? [])
            .filter((driver) => driver.finding_key === selectedFinding.finding_key)
            .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
            .slice(0, 10),
    [result, selectedFinding],
  )

  const title = analysis?.title ?? 'What changed and why'
  const pick = (finding: Finding, event: MouseEvent<HTMLTableRowElement>) => {
    if (selected?.findingKey === finding.finding_key) {
      setSelected(undefined)
      return
    }
    const card = event.currentTarget.closest('.kit-changes')
    const row = event.currentTarget.getBoundingClientRect()
    const top = card === null ? undefined : row.top - card.getBoundingClientRect().top
    setSelected({ findingKey: finding.finding_key, ...(top === undefined ? {} : { row: { top, height: row.height } }) })
  }

  if (analysis === undefined) {
    return (
      <section className="kit-section">
        <SectionHead title={title} />
        <div className="bda-card bda-subtle kit-changes__note">No analysis is declared for this panel.</div>
      </section>
    )
  }

  const job = run.job
  const live = phase === 'queued' || phase === 'running'
  const failed = phase === 'failed' || phase === 'abandoned'
  const retryAfter = job?.error?.retry_after_s
  const stateLine =
    phase === undefined
      ? 'Not run yet'
      : phase === 'queued'
        ? `Queued${typeof job?.position === 'number' ? ` · ${ordinal(job.position)} in line` : ''}`
        : phase === 'running'
          ? `Running${typeof job?.elapsed_s === 'number' ? ` · ${Math.round(job.elapsed_s)} s` : ''}`
          : phase === 'done'
            ? `${findings.length === 1 ? '1 finding' : `${findings.length} findings`}${job?.cached === true ? ' · from earlier today' : ''}`
            : phase === 'abandoned'
              ? `Abandoned${typeof retryAfter === 'number' && retryAfter > 0 ? ` · try again in ${Math.ceil(retryAfter / 60)} min` : ''}`
              : 'Failed'
  const error = failed ? (run.error ?? new BdaError(job?.error?.code ?? (phase === 'abandoned' ? 'analysis_abandoned' : 'analysis_failed'), job?.error?.message ?? 'The analysis did not finish.', 0)) : null

  return (
    <section className="kit-section">
      <SectionHead
        title={title}
        right={
          <span className="kit-changes__state" data-phase={phase ?? 'idle'}>
            <span className="bda-subtle">{[windowLabel(window), stateLine].filter((part) => part !== '').join(' · ')}</span>
            {phase === undefined ? (
              <button type="button" className="bda-pill" onClick={() => setAttempt(1)}>
                Run
              </button>
            ) : null}
            {live && job !== undefined ? (
              <button type="button" className="kit-cause__link" onClick={() => cancelAnalysis(job.job_id)}>
                Cancel
              </button>
            ) : null}
          </span>
        }
      />
      <Widget
        className="bda-card kit-tcard kit-changes"
        heading={null}
        pending={phase !== undefined && result === undefined && !failed}
        fetching={live && result !== undefined}
        error={error}
        onRetry={() => setAttempt((value) => value + 1)}
        skeleton={{ kind: 'table', rows: 5 }}
        empty={phase === 'done' && findings.length === 0}
        digest={findings.slice(0, 10).map((finding) => ({ segment: segmentLabel(spec, finding.dimensions), current: finding.current_value, baseline: finding.baseline_value, pct_change: finding.pct_change, severity: finding.severity }))}
        findings={reports.length === 0 ? undefined : reports}
      >
        {phase === undefined ? (
          <div className="bda-subtle kit-changes__note">Runs a Detect &amp; Explain analysis over this window, as you.</div>
        ) : findings.length === 0 ? (
          <div className="bda-subtle kit-changes__note">{phase === 'done' ? (result?.summary?.message ?? 'Nothing moved outside its usual range.') : null}</div>
        ) : (
          <>
            {(job?.notices ?? []).map((notice) => (
              <div key={notice.code} className="bda-subtle kit-changes__note">
                {notice.message}
              </div>
            ))}
            <div className="kit-scroll">
              <table className="bda-table kit-table">
                <thead>
                  <tr>
                    <th>Segment</th>
                    <th className="bda-numeric">Now</th>
                    <th className="bda-numeric">Before</th>
                    <th className="bda-numeric">Change</th>
                    <th>Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {findings.map((finding) => {
                    const isSelected = finding.finding_key === selected?.findingKey
                    return (
                      <tr key={finding.finding_key} data-finding-key={finding.finding_key} className={isSelected ? 'kit-row kit-selected' : 'kit-row'} aria-selected={isSelected} onClick={(event) => pick(finding, event)}>
                        <td>{segmentLabel(spec, finding.dimensions)}</td>
                        <td className="bda-numeric kit-mono">{num(finding.current_value)}</td>
                        <td className="bda-numeric kit-mono">{num(finding.baseline_value)}</td>
                        <td className="bda-numeric kit-mono">{pct(finding.pct_change)}</td>
                        <td>{finding.severity === null ? '—' : <span className={`kit-changes__sev kit-changes__sev--${finding.severity}`}>{finding.severity}</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {result?.truncated?.findings === true || (result?.findings.length ?? 0) > findings.length ? <div className="bda-subtle kit-changes__note">{`Showing the first ${findings.length} findings.`}</div> : null}
            {selectedFinding !== undefined ? (
              <div className="kit-changes__detail">
                <div className="kit-sh">{`What drove ${segmentLabel(spec, selectedFinding.dimensions)}`}</div>
                {drivers.length === 0 ? (
                  <div className="bda-subtle kit-changes__note">No sub-segment accounts for this move on its own.</div>
                ) : (
                  <table className="bda-table kit-table kit-changes__drivers">
                    <thead>
                      <tr>
                        <th>Driver</th>
                        <th className="bda-numeric">Now</th>
                        <th className="bda-numeric">Before</th>
                        <th className="bda-numeric">Change</th>
                        <th className="bda-numeric">Share of move</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drivers.map((driver) => (
                        <tr key={driver.driver_key}>
                          <td>{segmentLabel(spec, driver.dimensions)}</td>
                          <td className="bda-numeric kit-mono">{num(driver.current_value)}</td>
                          <td className="bda-numeric kit-mono">{num(driver.baseline_value)}</td>
                          <td className="bda-numeric kit-mono">{pct(driver.pct_change)}</td>
                          <td className="bda-numeric kit-mono">{typeof driver.parent_contribution_pct === 'number' ? `${driver.parent_contribution_pct.toFixed(0)}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <CauseCard finding={findingRef(spec, selectedFinding, jobId, panelId)} />
              </div>
            ) : null}
          </>
        )}
      </Widget>
    </section>
  )
}
