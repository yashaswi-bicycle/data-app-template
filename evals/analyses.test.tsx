/**
 * Declared analyses and the "What changed and why" panel (`changes`).
 *
 * The frame never fetches: the panel asks the host with
 * `studio:sandbox:analysis` and the host answers `studio:sandbox:analysis-result`
 * every time the job moves (`runtime/src/studio/analysis.ts`). A fake host
 * frame captures the requests and answers them by hand. What this pins:
 *
 *  - the run request: the declared analysis id, the panel's window as the
 *    service's inclusive `{from, through}`, only the filters actually narrowed;
 *  - every job state on screen: queued (and where in line), running, done,
 *    failed and abandoned (Retry runs again), a cancelled job reads abandoned;
 *  - findings keyed by `finding_key`, reported to the host in
 *    `studio:sandbox:context` (`findings[]`), a picked row reported as the
 *    selection, its drivers and its `CauseCard`;
 *  - unmounting stops listening (`unwatch`) without cancelling the job.
 *
 * The composer's half (`analyses[]` validated and carried into the manifest)
 * is `evals/compose-analyses.test.tsx`, which needs node rather than a DOM.
 *
 * Synthetic spec and rows only — no real customer or model ids.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CORE } from '../runtime/src/App.js'
import { ControlsProvider } from '../runtime/src/controls.js'
import type { CoreData, QueryState } from '../runtime/src/data.js'
import type { Spec } from '../runtime/src/spec.js'
import { filtersOf, phaseOf, windowOf } from '../runtime/src/studio/analysis.js'
import { flushReportForTests, PanelMetaProvider, resetRegistryForTests } from '../runtime/src/studio/contextRegistry.js'

const SPEC: Spec = {
  version: 2,
  model: 'm_retail_demo',
  title: 'Demo report',
  persona: 'pm',
  template: 'report',
  chrome: 'report',
  time: { from: '2026-09-14', to: '2026-09-21', grain: 'day' },
  measures: [{ id: 'revenue', column: 'revenue_total', label: 'Revenue', role: 'primary' }],
  dimensions: [
    { field: 'region', label: 'Region' },
    { field: 'channel', label: 'Channel' },
  ],
  questions: [],
  controls: [
    { kind: 'filter', dim: 'region', multi: true, options: ['North', 'South', 'East'], default: ['North', 'South'] },
    { kind: 'filter', dim: 'channel', multi: true, options: ['web', 'store'] },
  ],
  analyses: [
    {
      id: 'why_revenue',
      kind: 'explain',
      title: 'What moved revenue',
      config: { request: { kpi_name: 'revenue_total', mode: 'DETECT_AND_EXPLAIN', dimensions: ['region', 'channel'] }, window: { relative: 'last_week' }, baseline_window: { shift: 'P7D' } },
    },
  ],
}

function pending<T>(): QueryState<T> {
  return { rows: undefined, isPending: true, isFetching: false, error: null, refetch: () => {} }
}

const EMPTY_CORE: CoreData = { totals: pending(), series: pending(), dims: pending(), trendBy: () => pending(), slicesAt: () => [] }

const FINDINGS = [
  {
    finding_key: 'f0000000000000000001',
    question_key: 'q0000000000000000001',
    kpi_name: 'revenue_total',
    segment_key: 'region=North',
    dimensions: { region: 'North' },
    current_value: 6200,
    baseline_value: 10000,
    delta: -3800,
    pct_change: -38,
    severity: 'high',
    window_start: '2026-09-14T00:00:00Z',
    window_end: '2026-09-21T00:00:00Z',
    baseline_start: '2026-09-07T00:00:00Z',
    baseline_end: '2026-09-14T00:00:00Z',
    evidence: { unmapped: 1 },
  },
  {
    finding_key: 'f0000000000000000002',
    kpi_name: 'revenue_total',
    segment_key: 'channel=web',
    dimensions: { channel: 'web' },
    current_value: 12000,
    baseline_value: 9000,
    delta: 3000,
    pct_change: 33.3,
    severity: 'medium',
    window_start: '2026-09-14T00:00:00Z',
    window_end: '2026-09-21T00:00:00Z',
  },
]

const DRIVERS = [
  { driver_key: 'd2', finding_key: 'f0000000000000000001', segment_key: 'channel=store|region=North', dimensions: { region: 'North', channel: 'store' }, current_value: 1000, baseline_value: 4000, delta: -3000, pct_change: -75, parent_contribution_pct: 79, rank: 1 },
  { driver_key: 'd3', finding_key: 'f0000000000000000002', segment_key: 'channel=web|region=East', dimensions: { region: 'East', channel: 'web' }, current_value: 5000, baseline_value: 2000, delta: 3000, pct_change: 150, parent_contribution_pct: 100, rank: 1 },
]

function job(state: string, extra: Record<string, unknown> = {}) {
  return { job_id: 'aj_00000000000000000001', analysis_id: 'why_revenue', kind: 'explain', state, ...extra }
}

function mockHostFrame(): ReturnType<typeof vi.fn> {
  const postMessage = vi.fn()
  Object.defineProperty(window, 'parent', { value: { postMessage }, configurable: true })
  return postMessage
}

function restoreHostFrame(): void {
  Object.defineProperty(window, 'parent', { value: window, configurable: true })
}

afterEach(() => {
  cleanup()
  resetRegistryForTests()
  restoreHostFrame()
  delete window.__BDA_CONTEXT
})

/** A capture: the host's render state says snapshot, and may hand over last results. */
function captureMode(analyses?: Record<string, unknown>): void {
  window.__BDA_CONTEXT = { state: { snapshot: true, ...(analyses === undefined ? {} : { analyses }) } } as never
}

async function panelReport(postMessage: ReturnType<typeof vi.fn>) {
  postMessage.mockClear()
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushReportForTests()
  })
  const [context] = sent(postMessage, 'studio:sandbox:context')
  return context.panels.find((entry: { panelId: string }) => entry.panelId === 'p3:changes')
}

const sent = (postMessage: ReturnType<typeof vi.fn>, type: string) => postMessage.mock.calls.map((call) => call[0]).filter((message) => message?.type === type)

function push(data: Record<string, unknown>): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }))
  })
}

function mountChanges(spec: Spec = SPEC, bind: Record<string, unknown> = {}) {
  const Recipe = CORE.changes
  if (Recipe === undefined) throw new Error('no "changes" core recipe')
  const meta = { panelId: 'p3:changes', recipe: 'changes', say: 'What changed?', bind }
  return render(
    <ControlsProvider spec={spec}>
      <PanelMetaProvider value={meta}>
        <Recipe spec={spec} core={EMPTY_CORE} bind={bind} />
      </PanelMetaProvider>
    </ControlsProvider>,
  )
}

describe('analysis helpers', () => {
  it('turns the panel range into the inclusive window the service takes', () => {
    expect(windowOf({ from: '2026-09-14', to: '2026-09-21' })).toEqual({ from: '2026-09-14', through: '2026-09-20' })
    expect(windowOf({ from: '2026-09-14', to: '2026-09-14' })).toBeUndefined()
  })

  it('sends only the filters that are narrowed', () => {
    const options = (dim: string) => (dim === 'region' ? ['North', 'South', 'East'] : ['web', 'store'])
    expect(filtersOf({ region: ['North'], channel: ['web', 'store'] }, options)).toEqual([{ field: 'region', op: 'in', value: ['North'] }])
  })

  it('reads a cancelled job and the abandoned code as abandoned', () => {
    expect(phaseOf(job('queued') as never)).toBe('queued')
    expect(phaseOf(job('running') as never)).toBe('running')
    expect(phaseOf(job('succeeded') as never)).toBe('done')
    expect(phaseOf(job('failed', { error: { code: 'analysis_timeout', message: 'x' } }) as never)).toBe('failed')
    expect(phaseOf(job('failed', { error: { code: 'analysis_abandoned', message: 'x' } }) as never)).toBe('abandoned')
    expect(phaseOf(job('cancelled') as never)).toBe('abandoned')
    expect(phaseOf(undefined, { code: 'analysis_abandoned' })).toBe('abandoned')
    expect(phaseOf(undefined, { code: 'budget_exhausted' })).toBe('failed')
  })
})

describe('changes panel', () => {
  it('runs the declared analysis through the host and shows every job state', async () => {
    const postMessage = mockHostFrame()
    mountChanges()
    const [run] = sent(postMessage, 'studio:sandbox:analysis')
    expect(run).toMatchObject({ action: 'run', analysisId: 'why_revenue', window: { from: '2026-09-14', through: '2026-09-20' }, filters: [{ field: 'region', op: 'in', value: ['North', 'South'] }] })
    expect(run).not.toHaveProperty('appId')
    expect(screen.getByText('What moved revenue')).toBeTruthy()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()

    push({ type: 'studio:sandbox:analysis-result', requestId: run.requestId, ok: true, job: job('queued', { position: 2 }), final: false })
    expect(screen.getByText(/Queued · 2nd in line/)).toBeTruthy()
    push({ type: 'studio:sandbox:analysis-result', requestId: run.requestId, ok: true, job: job('running', { elapsed_s: 12 }), final: false })
    expect(screen.getByText(/Running · 12 s/)).toBeTruthy()
    push({ type: 'studio:sandbox:analysis-result', requestId: run.requestId, ok: true, job: job('succeeded', { cached: true }), result: { job_id: 'aj_00000000000000000001', state: 'succeeded', findings: FINDINGS, drivers: DRIVERS }, final: true })
    expect(screen.getByText(/2 findings · from earlier today/)).toBeTruthy()
    expect(screen.getByText('Region: North')).toBeTruthy()
    expect(screen.getByText('−38.0%')).toBeTruthy()
    expect(document.querySelectorAll('tr[data-finding-key]')).toHaveLength(2)

    // The panel reports its findings for the host's "Why?" pill.
    postMessage.mockClear()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      flushReportForTests()
    })
    const [context] = sent(postMessage, 'studio:sandbox:context')
    const panel = context.panels.find((entry: { panelId: string }) => entry.panelId === 'p3:changes')
    expect(panel.findings).toHaveLength(2)
    expect(panel.findings[0]).toMatchObject({ findingKey: 'f0000000000000000001', jobId: 'aj_00000000000000000001', subject: { model: 'm_retail_demo', metric: 'revenue_total', segment_key: 'region=North', window: { from: '2026-09-14', through: '2026-09-20' } } })
    expect(panel.findings[0].subjectKey).toMatch(/^[0-9a-f]{20}$/)
    // Trimmed: the engine's unmapped evidence does not travel.
    expect(panel.findings[0].row).not.toHaveProperty('evidence')
    expect(panel.status).toBe('ready')
  })

  it('picks a finding: selection, drivers, and a cause card asking about it', async () => {
    const postMessage = mockHostFrame()
    mountChanges()
    const [run] = sent(postMessage, 'studio:sandbox:analysis')
    push({ type: 'studio:sandbox:analysis-result', requestId: run.requestId, ok: true, job: job('succeeded'), result: { job_id: 'aj_00000000000000000001', state: 'succeeded', findings: FINDINGS, drivers: DRIVERS }, final: true })
    postMessage.mockClear()
    fireEvent.click(screen.getByText('Region: North'))
    expect(screen.getByText('What drove Region: North')).toBeTruthy()
    expect(screen.getByText('Region: North · Channel: store')).toBeTruthy()
    // Only this finding's drivers.
    expect(screen.queryByText('Region: East · Channel: web')).toBeNull()

    const [get] = sent(postMessage, 'studio:sandbox:agent-run')
    expect(get).toMatchObject({ action: 'get', agentId: 'cause', findingKey: 'f0000000000000000001', jobId: 'aj_00000000000000000001', panelId: 'p3:changes', row: { current_value: 6200, baseline_value: 10000 } })

    await act(async () => {
      flushReportForTests()
    })
    const [context] = sent(postMessage, 'studio:sandbox:context')
    const panel = context.panels.find((entry: { panelId: string }) => entry.panelId === 'p3:changes')
    expect(panel.selection).toMatchObject({ findingKey: 'f0000000000000000001' })
    expect(panel.selection.row).toMatchObject({ top: expect.any(Number), height: expect.any(Number) })
  })

  it('a failed run shows what failed and Retry runs it again', () => {
    const postMessage = mockHostFrame()
    mountChanges()
    const [run] = sent(postMessage, 'studio:sandbox:analysis')
    push({ type: 'studio:sandbox:analysis-result', requestId: run.requestId, ok: false, error: { code: 'budget_exhausted', message: 'The daily analysis budget is spent.', status: 429 } })
    expect(screen.getByText('budget_exhausted')).toBeTruthy()
    expect(screen.getByText(/Failed/)).toBeTruthy()
    fireEvent.click(screen.getByText('Retry'))
    expect(sent(postMessage, 'studio:sandbox:analysis').filter((message) => message.action === 'run')).toHaveLength(2)
  })

  it('an abandoned job says so, with when to try again', () => {
    const postMessage = mockHostFrame()
    mountChanges()
    const [run] = sent(postMessage, 'studio:sandbox:analysis')
    push({ type: 'studio:sandbox:analysis-result', requestId: run.requestId, ok: true, job: job('failed', { error: { code: 'analysis_abandoned', message: 'Someone gave up on this question.', retry_after_s: 600 } }), final: true })
    expect(screen.getByText(/Abandoned · try again in 10 min/)).toBeTruthy()
    expect(screen.getByText('analysis_abandoned')).toBeTruthy()
  })

  it('Cancel abandons the live job; unmounting only stops listening', () => {
    const postMessage = mockHostFrame()
    const { unmount } = mountChanges()
    const [run] = sent(postMessage, 'studio:sandbox:analysis')
    push({ type: 'studio:sandbox:analysis-result', requestId: run.requestId, ok: true, job: job('running'), final: false })
    fireEvent.click(screen.getByText('Cancel'))
    expect(sent(postMessage, 'studio:sandbox:analysis').find((message) => message.action === 'cancel')).toMatchObject({ jobId: 'aj_00000000000000000001' })
    unmount()
    expect(sent(postMessage, 'studio:sandbox:analysis').find((message) => message.action === 'unwatch')).toMatchObject({ requestId: run.requestId })
  })

  it('bind.run manual waits for the viewer', () => {
    const postMessage = mockHostFrame()
    mountChanges(SPEC, { run: 'manual' })
    expect(sent(postMessage, 'studio:sandbox:analysis')).toHaveLength(0)
    fireEvent.click(screen.getByText('Run'))
    expect(sent(postMessage, 'studio:sandbox:analysis')).toHaveLength(1)
  })

  it('an app with no analysis declared says so instead of asking', () => {
    const postMessage = mockHostFrame()
    const { analyses: _analyses, ...bare } = SPEC
    mountChanges(bare)
    expect(screen.getByText('No analysis is declared for this panel.')).toBeTruthy()
    expect(sent(postMessage, 'studio:sandbox:analysis')).toHaveLength(0)
  })

  it('in a capture, never runs: says the analysis was not run and is ready at once', async () => {
    captureMode()
    const postMessage = mockHostFrame()
    mountChanges()
    expect(sent(postMessage, 'studio:sandbox:analysis')).toHaveLength(0)
    expect(screen.getByText(/Analysis not run/)).toBeTruthy()
    expect(screen.queryByText('Run')).toBeNull()
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
    expect((await panelReport(postMessage)).status).toBe('ready')
  })

  it('in a capture, shows the last completed result the host provided', async () => {
    captureMode({ why_revenue: { job_id: 'aj_00000000000000000001', state: 'succeeded', findings: FINDINGS, drivers: DRIVERS } })
    const postMessage = mockHostFrame()
    mountChanges()
    expect(sent(postMessage, 'studio:sandbox:analysis')).toHaveLength(0)
    expect(screen.getByText('Region: North')).toBeTruthy()
    expect((await panelReport(postMessage)).status).toBe('ready')
    // Picking a row in a capture asks no agent.
    postMessage.mockClear()
    fireEvent.click(screen.getByText('Region: North'))
    expect(sent(postMessage, 'studio:sandbox:agent-run')).toHaveLength(0)
  })

  it('an environment without analyses is a muted note, not an error card', () => {
    const postMessage = mockHostFrame()
    mountChanges()
    const [run] = sent(postMessage, 'studio:sandbox:analysis')
    push({ type: 'studio:sandbox:analysis-result', requestId: run.requestId, ok: false, error: { code: 'analysis_unavailable', message: 'Off for this tenant.', status: 503 } })
    expect(screen.getByText('Analyses are not available here.')).toBeTruthy()
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it("reports the panel's filters with each finding and sends them when a run starts", async () => {
    const postMessage = mockHostFrame()
    mountChanges()
    const [run] = sent(postMessage, 'studio:sandbox:analysis')
    push({ type: 'studio:sandbox:analysis-result', requestId: run.requestId, ok: true, job: job('succeeded'), result: { job_id: 'aj_00000000000000000001', state: 'succeeded', findings: FINDINGS, drivers: DRIVERS }, final: true })
    const panel = await panelReport(postMessage)
    expect(panel.findings[0].filters).toEqual([{ field: 'region', op: 'in', value: ['North', 'South'] }])
    fireEvent.click(screen.getByText('Region: North'))
    const [get] = sent(postMessage, 'studio:sandbox:agent-run')
    push({ type: 'studio:sandbox:agent-run-result', requestId: get.requestId, ok: true, findingKey: 'f0000000000000000001', subjectKey: null, runId: null, state: 'none', match: null, asOf: null })
    await act(async () => {})
    expect(get).not.toHaveProperty('filters')
    fireEvent.click(screen.getByText('Why did this change?'))
    const start = sent(postMessage, 'studio:sandbox:agent-run').find((message) => message.action === 'start')
    expect(start.filters).toEqual([{ field: 'region', op: 'in', value: ['North', 'South'] }])
  })
})
