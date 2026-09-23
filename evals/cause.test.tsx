/**
 * `useAgentRun` + `CauseCard`: an agent run about one finding, brokered by
 * the host (`studio:sandbox:agent-run` / `studio:sandbox:agent-run-result`,
 * `runtime/src/studio/agentRun.ts`).
 *
 * What this pins:
 *  - on mount the card asks `get` for its finding, with the live row values
 *    the service's stale check reads, and never an `appId`;
 *  - it follows pushed updates for its finding even when it never asked
 *    (a run the host's own "Why?" pill started), and ignores other findings';
 *  - each derived state renders: none (a start button), investigating
 *    (progress + Cancel), explained (causes), stale / rejected (Re-run with
 *    `rerun: true`), failed (Try again), a subject match labelled with its
 *    own window;
 *  - agent text is text: `[fig:n]` becomes a chip from the run's checked
 *    figures, `[n]` opens that cause's evidence, and markup stays literal;
 *  - ✓ / ✗ / correct post feedback with the run id and the cause ids;
 *  - `subject_key` matches Studio's Python byte for byte.
 *
 * Synthetic rows only — no real customer or model ids.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CauseCard } from '../runtime/src/chrome/CauseCard.js'
import { type FindingRef, requestAgentRun, sha256Hex, subjectKey, subjectOfRow, windowSpec } from '../runtime/src/studio/agentRun.js'

const FINDING: FindingRef = {
  findingKey: 'f0000000000000000001',
  subjectKey: '656475355b63383a7648',
  jobId: 'aj_00000000000000000001',
  subject: { model: 'm_retail_demo', metric: 'revenue', segment_key: 'region=North', window: { from: '2026-09-14', through: '2026-09-20' }, baseline: { shift: 'P7D' } },
  row: { finding_key: 'f0000000000000000001', current_value: 6200, baseline_value: 10000 },
  panelId: 'p3:changes',
}

const OUTPUT = {
  verdict: 'explained',
  figures: [
    { fig: 1, value: -38.1, unit: 'pct' },
    { fig: 2, value: 61.2, unit: 'pct' },
  ],
  causes: [
    {
      cause_id: 'c1',
      rank: 1,
      type: 'segment_drop',
      title: 'Store sales in North fell [fig:1] <b>really</b>',
      mechanism: 'The store channel carried [fig:2] of the drop [1].',
      share_of_change_pct: 61.2,
      confidence: 0.78,
      evidence: [
        { ref: 1, kind: 'query', evidence_id: 'e3', sql: 'SELECT revenue_total, channel FROM m_retail_demo GROUP BY channel', cache_only: false },
        { ref: 2, kind: 'finding', finding_key: 'f0000000000000000001' },
      ],
      next_checks: ['Was a store closed that week?'],
    },
  ],
}

function runView(state: string, extra: Record<string, unknown> = {}) {
  return { run_id: 'run_00000000000000000001', finding_key: FINDING.findingKey, subject_key: FINDING.subjectKey, status: state === 'investigating' ? 'running' : 'succeeded', state, terminal: state !== 'investigating', ...extra }
}

function mockHostFrame(): ReturnType<typeof vi.fn> {
  const postMessage = vi.fn()
  Object.defineProperty(window, 'parent', { value: { postMessage }, configurable: true })
  return postMessage
}

afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'parent', { value: window, configurable: true })
})

const requests = (postMessage: ReturnType<typeof vi.fn>) => postMessage.mock.calls.map((call) => call[0]).filter((message) => message?.type === 'studio:sandbox:agent-run')

function push(data: Record<string, unknown>): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'studio:sandbox:agent-run-result', ok: true, findingKey: FINDING.findingKey, subjectKey: FINDING.subjectKey, match: null, asOf: null, runId: null, ...data } }))
  })
}

async function answerFirst(postMessage: ReturnType<typeof vi.fn>, data: Record<string, unknown>): Promise<void> {
  const [first] = requests(postMessage)
  push({ requestId: first.requestId, ...data })
  await act(async () => {})
}

describe('CauseCard', () => {
  it('asks for its finding on mount and offers to start when nothing was asked yet', async () => {
    const postMessage = mockHostFrame()
    render(<CauseCard finding={FINDING} />)
    const [get] = requests(postMessage)
    expect(get).toMatchObject({ action: 'get', agentId: 'cause', findingKey: FINDING.findingKey, subjectKey: FINDING.subjectKey, jobId: FINDING.jobId, row: { current_value: 6200, baseline_value: 10000 } })
    expect(get).not.toHaveProperty('appId')
    expect(document.querySelector('.kit-cause[aria-busy="true"]')).not.toBeNull()

    await answerFirst(postMessage, { state: 'none' })
    fireEvent.click(screen.getByText('Why did this change?'))
    const start = requests(postMessage).find((message) => message.action === 'start')
    expect(start).toMatchObject({ findingKey: FINDING.findingKey, panelId: 'p3:changes', subject: FINDING.subject })
    expect(start).not.toHaveProperty('rerun')
  })

  it('follows pushed updates for its own finding only, through to a checked answer', async () => {
    const postMessage = mockHostFrame()
    render(<CauseCard finding={FINDING} />)
    await answerFirst(postMessage, { state: 'none' })

    // Someone else's finding moves: nothing changes here.
    push({ findingKey: 'f9999999999999999999', runId: 'run_other', state: 'investigating', run: runView('investigating', { finding_key: 'f9999999999999999999', progress: 'Not mine' }) })
    expect(screen.queryByText('Not mine')).toBeNull()

    // The host's own pill started a run for this finding: pushed without a requestId.
    push({ runId: 'run_00000000000000000001', state: 'investigating', run: runView('investigating', { progress: 'Decomposing by Channel' }) })
    expect(screen.getByText('Decomposing by Channel')).toBeTruthy()
    fireEvent.click(screen.getByText('Cancel'))
    const cancel = requests(postMessage).find((message) => message.action === 'cancel')
    expect(cancel).toMatchObject({ runId: 'run_00000000000000000001' })
    // The host answers the cancel (the run had already finished), then pushes the finished run.
    push({ requestId: cancel.requestId, runId: 'run_00000000000000000001', state: 'investigating', run: runView('investigating') })
    await act(async () => {})

    push({ runId: 'run_00000000000000000001', state: 'explained', run: runView('explained', { output: OUTPUT, feedback: { mine: null, accepted_by_count: 2, rejected_by_count: 0, accepted: true } }) })
    expect(screen.getByText('Explained')).toBeTruthy()
    // Figures as chips, from the run's own checked figures.
    const chips = [...document.querySelectorAll('.kit-cause__fig')].map((node) => node.textContent)
    expect(chips).toEqual(['−38.1%', '+61.2%'])
    // Text-only: the markup in a title is shown, never rendered.
    expect(document.querySelector('.kit-cause b')).toBeNull()
    expect(screen.getByText(/<b>really<\/b>/)).toBeTruthy()
    expect(screen.getByText('confirmed by 2')).toBeTruthy()
    expect(screen.getByText('Was a store closed that week?')).toBeTruthy()

    // [n] opens that cause's evidence: the query the agent ran.
    const [ref] = screen.getAllByText('[1]')
    fireEvent.click(ref as HTMLElement)
    expect(screen.getByText(/GROUP BY channel/)).toBeTruthy()

    fireEvent.click(screen.getByText('✓ Right'))
    expect(requests(postMessage).find((message) => message.action === 'feedback')).toMatchObject({ runId: 'run_00000000000000000001', verdict: 'accept', causeIds: ['c1'] })
  })

  it('a correction carries its note', async () => {
    const postMessage = mockHostFrame()
    render(<CauseCard finding={FINDING} />)
    await answerFirst(postMessage, { runId: 'run_00000000000000000001', state: 'partial', run: runView('partial', { output: { ...OUTPUT, verdict: 'partial' } }) })
    expect(screen.getByText('Partly explained')).toBeTruthy()
    fireEvent.click(screen.getByText('Correct…'))
    fireEvent.change(screen.getByLabelText('What is the real reason?'), { target: { value: 'A store was closed for a refit.' } })
    fireEvent.click(screen.getByText('Send'))
    expect(requests(postMessage).find((message) => message.action === 'feedback')).toMatchObject({ verdict: 'correct', note: 'A store was closed for a refit.', causeIds: ['c1'] })
  })

  it('stale and rejected offer a re-run with a fresh key', async () => {
    const postMessage = mockHostFrame()
    render(<CauseCard finding={FINDING} />)
    await answerFirst(postMessage, { runId: 'run_00000000000000000001', state: 'stale', run: runView('stale', { output: OUTPUT, stale: true }) })
    expect(screen.getByText('The numbers have moved since this was explained.')).toBeTruthy()
    fireEvent.click(screen.getByText('Re-run'))
    expect(requests(postMessage).find((message) => message.action === 'start')).toMatchObject({ rerun: true })

    push({ runId: 'run_00000000000000000001', state: 'rejected', run: runView('rejected', { output: OUTPUT, feedback: { mine: { verdict: 'reject' }, accepted_by_count: 0, rejected_by_count: 1, accepted: false } }) })
    expect(screen.getByText('You marked this explanation wrong.')).toBeTruthy()
    expect(screen.getByText('✗ Wrong').getAttribute('aria-pressed')).toBe('true')
  })

  it('a failed run says why and offers to try again; a subject match names its own window', async () => {
    const postMessage = mockHostFrame()
    render(<CauseCard finding={FINDING} />)
    await answerFirst(postMessage, { runId: 'run_00000000000000000001', state: 'failed', run: runView('failed', { status: 'failed', error: { code: 'run_timeout', message: 'The agent ran out of time.' } }) })
    expect(screen.getByText('The agent ran out of time.')).toBeTruthy()
    fireEvent.click(screen.getByText('Try again'))
    expect(requests(postMessage).find((message) => message.action === 'start')).toMatchObject({ rerun: true })

    push({ runId: 'run_00000000000000000002', state: 'explained', match: 'subject', asOf: '2026-09-15T10:00:00Z', run: runView('explained', { run_id: 'run_00000000000000000002', match: 'subject', window: { from: '2026-09-07', through: '2026-09-13' }, output: OUTPUT }) })
    expect(screen.getByText(/explained for Sep 7 – Sep 13 \(as of Sep 15\)/)).toBeTruthy()
  })

  it('a host with no agent runs is a muted note, never an error card', async () => {
    const postMessage = mockHostFrame()
    render(<CauseCard finding={FINDING} />)
    const [first] = requests(postMessage)
    push({ requestId: first.requestId, ok: false, error: { code: 'agent_runs_unavailable', message: 'No agent service.', status: 503 } })
    expect(screen.getByText('Explanations are not available here.')).toBeTruthy()
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })
})

describe('subject_key', () => {
  it('is SHA-256, correctly', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('a'.repeat(200))).toBe('c2a908d98f5df987ade41b5fce213067efbcc21ef2240212a41e54b5e7c28ae5')
  })

  // Expected values computed by bicycle-studio-api's `agent_runs/keys.py::subject_key`.
  it("matches Studio's key for a dated window, a relative one and a non-ASCII metric", () => {
    expect(subjectKey({ model: 'm_retail_demo', metric: 'revenue', segment_key: 'region=North', window: { from: '2026-09-14', through: '2026-09-20' }, baseline: { shift: 'P7D' } })).toBe('656475355b63383a7648')
    expect(subjectKey({ model: 'm_retail_demo', metric: 'revenue', segment_key: '', window: { from: '2026-09-21', through: '2026-09-27' }, baseline: { from: '2026-09-14', through: '2026-09-20' } })).toBe('176f97dcfa23fdf53c30')
    expect(subjectKey({ model: 'm_retail_demo', metric: 'Überumsatz ☃', segment_key: '', window: { relative: 'last_week' } })).toBe('2bc157e452b868c985e4')
  })

  it('stays the same when a weekly window rolls over', () => {
    const week = (from: string, through: string) => subjectKey({ model: 'm_retail_demo', metric: 'revenue', segment_key: '', window: { from, through } })
    expect(week('2026-09-14', '2026-09-20')).toBe(week('2026-09-21', '2026-09-27'))
    expect(windowSpec({ from: '2026-09-14', through: '2026-09-20' }, { shift: 'P7D' })).toBe('P7D|P7D')
  })

  it('reads a finding row the way Studio does: half-open ends become the inclusive last day', () => {
    expect(subjectOfRow({ kpi_name: 'revenue', segment_key: 'region=North', window_start: '2026-09-14T00:00:00Z', window_end: '2026-09-21T00:00:00Z', baseline_start: '2026-09-07', baseline_end: '2026-09-13' }, 'm_retail_demo')).toEqual({
      model: 'm_retail_demo',
      metric: 'revenue',
      segment_key: 'region=North',
      window: { from: '2026-09-14', through: '2026-09-20' },
      baseline: { from: '2026-09-07', through: '2026-09-13' },
    })
  })
})

describe('agent runs with the agent\'s own input', () => {
  it('start carries input verbatim for an agent whose input is not a finding (form (a)); get never does', async () => {
    const postMessage = mockHostFrame()
    const input = { source: { model: 'm_retail_demo', sql: 'SELECT module, order_id FROM m_retail_demo WHERE ts >= :from', params: { from: '2026-09-14' } }, match: { text: 'summary' }, provider: 'mock:atlassian' }
    void requestAgentRun({ action: 'start', agentId: 'ticket_coverage', findingKey: 'tc_2026-09-14_2026-09-15', panelId: 'ticket_coverage', input })
    void requestAgentRun({ action: 'get', agentId: 'ticket_coverage', findingKey: 'tc_2026-09-14_2026-09-15', input })
    const [start, get] = requests(postMessage)
    expect(start).toMatchObject({ action: 'start', agentId: 'ticket_coverage', findingKey: 'tc_2026-09-14_2026-09-15', panelId: 'ticket_coverage', input })
    expect(get).not.toHaveProperty('input')
  })
})
